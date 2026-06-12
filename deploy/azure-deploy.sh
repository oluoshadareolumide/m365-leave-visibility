#!/usr/bin/env bash
# =============================================================================
# Azure deployment script for M365 Leave Visibility
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - jq installed
#   - Node.js 20+
#   - Set the variables in the "Configuration" section below
#
# What this script does:
#   1. Creates a resource group
#   2. Deploys Azure App Service (API backend)
#   3. Deploys Azure Static Web Apps (add-in frontend)
#   4. Deploys Azure Function App (iTrent sync)
#   5. Creates Azure Cosmos DB account
#   6. Outputs the deployment URLs you need for manifest.xml
# =============================================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
# Edit these before running.

SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-}"
RESOURCE_GROUP="rg-leave-visibility-prod"
LOCATION="uksouth"
APP_NAME="leave-visibility"              # base name for all resources
NODE_VERSION="20"

# These must be pre-created in Azure Entra ID (see README).
AZURE_TENANT_ID="${AZURE_TENANT_ID:?AZURE_TENANT_ID required}"
AZURE_CLIENT_ID="${AZURE_CLIENT_ID:?AZURE_CLIENT_ID required}"
AZURE_CLIENT_SECRET="${AZURE_CLIENT_SECRET:?AZURE_CLIENT_SECRET required}"

ITRENT_BASE_URL="${ITRENT_BASE_URL:-}"
ITRENT_AUTH_METHOD="${ITRENT_AUTH_METHOD:-basic}"
ITRENT_USERNAME="${ITRENT_USERNAME:-}"
ITRENT_PASSWORD="${ITRENT_PASSWORD:-}"

# ─── Derived names ────────────────────────────────────────────────────────────
API_APP_NAME="${APP_NAME}-api"
FUNC_APP_NAME="${APP_NAME}-sync"
STATIC_APP_NAME="${APP_NAME}-addin"
COSMOS_ACCOUNT_NAME="${APP_NAME}-cosmos"
STORAGE_ACCOUNT_NAME="$(echo "${APP_NAME}storage" | tr -d '-' | cut -c1-24)"
APP_SERVICE_PLAN="${APP_NAME}-plan"

echo "=========================================="
echo "  M365 Leave Visibility — Azure Deploy"
echo "=========================================="
echo "Resource Group : $RESOURCE_GROUP"
echo "Location       : $LOCATION"
echo ""

# ─── 1. Resource group ────────────────────────────────────────────────────────
echo "[1/7] Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

# ─── 2. Cosmos DB ────────────────────────────────────────────────────────────
echo "[2/7] Creating Cosmos DB account (this takes ~3 min)..."
az cosmosdb create \
  --name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --kind GlobalDocumentDB \
  --default-consistency-level Session \
  --enable-automatic-failover false \
  --output none

az cosmosdb sql database create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "leave-visibility" \
  --output none

az cosmosdb sql container create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --database-name "leave-visibility" \
  --name "leave-records" \
  --partition-key-path "/pk" \
  --throughput 400 \
  --output none

COSMOS_ENDPOINT=$(az cosmosdb show \
  --name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "documentEndpoint" -o tsv)

COSMOS_KEY=$(az cosmosdb keys list \
  --name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "primaryMasterKey" -o tsv)

# ─── 3. App Service Plan ──────────────────────────────────────────────────────
echo "[3/7] Creating App Service Plan..."
az appservice plan create \
  --name "$APP_SERVICE_PLAN" \
  --resource-group "$RESOURCE_GROUP" \
  --sku B1 \
  --is-linux \
  --output none

# ─── 4. API backend (App Service) ────────────────────────────────────────────
echo "[4/7] Deploying API backend..."
az webapp create \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$APP_SERVICE_PLAN" \
  --runtime "NODE:${NODE_VERSION}-lts" \
  --output none

API_URL="https://${API_APP_NAME}.azurewebsites.net"

az webapp config appsettings set \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV=production \
    AZURE_TENANT_ID="$AZURE_TENANT_ID" \
    AZURE_CLIENT_ID="$AZURE_CLIENT_ID" \
    AZURE_CLIENT_SECRET="$AZURE_CLIENT_SECRET" \
    ITRENT_BASE_URL="$ITRENT_BASE_URL" \
    ITRENT_AUTH_METHOD="$ITRENT_AUTH_METHOD" \
    ITRENT_USERNAME="$ITRENT_USERNAME" \
    ITRENT_PASSWORD="$ITRENT_PASSWORD" \
    COSMOS_DB_ENDPOINT="$COSMOS_ENDPOINT" \
    COSMOS_DB_KEY="$COSMOS_KEY" \
    COSMOS_DB_DATABASE="leave-visibility" \
    COSMOS_DB_CONTAINER="leave-records" \
    CACHE_BACKEND="cosmos" \
    ALLOWED_ORIGINS="https://${STATIC_APP_NAME}.azurestaticapps.net" \
  --output none

# Build and deploy API
echo "  Building API..."
(cd server && npm ci && npm run build)
(cd server && zip -r ../api.zip dist package.json node_modules)
az webapp deployment source config-zip \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src api.zip
rm -f api.zip

# ─── 5. Storage for Azure Function ───────────────────────────────────────────
echo "[5/7] Creating storage account for Function App..."
az storage account create \
  --name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --output none

# ─── 6. Azure Function App (sync worker) ─────────────────────────────────────
echo "[6/7] Deploying sync Function App..."
az functionapp create \
  --name "$FUNC_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-account "$STORAGE_ACCOUNT_NAME" \
  --consumption-plan-location "$LOCATION" \
  --runtime node \
  --runtime-version "$NODE_VERSION" \
  --functions-version 4 \
  --os-type Linux \
  --output none

az functionapp config appsettings set \
  --name "$FUNC_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    AZURE_TENANT_ID="$AZURE_TENANT_ID" \
    AZURE_CLIENT_ID="$AZURE_CLIENT_ID" \
    AZURE_CLIENT_SECRET="$AZURE_CLIENT_SECRET" \
    ITRENT_BASE_URL="$ITRENT_BASE_URL" \
    ITRENT_AUTH_METHOD="$ITRENT_AUTH_METHOD" \
    ITRENT_USERNAME="$ITRENT_USERNAME" \
    ITRENT_PASSWORD="$ITRENT_PASSWORD" \
    COSMOS_DB_ENDPOINT="$COSMOS_ENDPOINT" \
    COSMOS_DB_KEY="$COSMOS_KEY" \
    COSMOS_DB_DATABASE="leave-visibility" \
    COSMOS_DB_CONTAINER="leave-records" \
    SYNC_CRON="0 */30 * * * *" \
  --output none

# Build and deploy Function
(cd server/azure-function-sync && npm ci && npm run build)
(cd server/azure-function-sync && zip -r ../../func.zip dist host.json package.json)
az functionapp deployment source config-zip \
  --name "$FUNC_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src func.zip
rm -f func.zip

# ─── 7. Static Web App (add-in frontend) ──────────────────────────────────────
echo "[7/7] Building and deploying add-in frontend..."
ADDIN_URL="https://${STATIC_APP_NAME}.azurestaticapps.net"

AZURE_CLIENT_ID="$AZURE_CLIENT_ID" \
AZURE_TENANT_ID="$AZURE_TENANT_ID" \
ADDIN_URL="$ADDIN_URL" \
API_BASE_URL="$API_URL" \
NODE_ENV=production \
  npm run build

az staticwebapp create \
  --name "$STATIC_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --source "dist" \
  --output none 2>/dev/null || true

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  Deployment complete!"
echo "=========================================="
echo ""
echo "  Add-in URL  : $ADDIN_URL"
echo "  API URL     : $API_URL"
echo ""
echo "  Next steps:"
echo "  1. Update manifest.xml — replace all {{ADDIN_URL}} with: $ADDIN_URL"
echo "  2. Replace {{CLIENT_ID}} with: $AZURE_CLIENT_ID"
echo "  3. Replace {{TENANT_ID}} with: $AZURE_TENANT_ID"
echo "  4. Generate a fresh GUID for {{ADDIN_GUID}}"
echo "  5. Upload the manifest via Microsoft 365 Admin Centre:"
echo "     Settings → Integrated apps → Upload custom apps"
echo ""
echo "  Entra ID app registration checklist:"
echo "  - Redirect URI: $ADDIN_URL/taskpane/taskpane.html (SPA)"
echo "  - Expose an API: api://$ADDIN_URL/$AZURE_CLIENT_ID"
echo "  - Add scope: access_as_user"
echo "  - Pre-authorize Office client IDs (see README)"
echo ""
