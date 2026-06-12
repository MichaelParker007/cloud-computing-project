#!/bin/bash
# =============================================================================
# deploy_gateway.sh — API Gateway für Versicherungs-Hub einrichten
# Projekt: project-64e4ee95-be58-4dea-8c0 | Region: europe-west3
# Einmaliger Deploy; für Updates: CONFIG_ID erhöhen (z.B. v2, v3)
# =============================================================================
set -euo pipefail

PROJECT_ID="project-64e4ee95-be58-4dea-8c0"
REGION="europe-west1"
API_ID="versicherung-hub-api"
CONFIG_ID="versicherung-hub-config-v3"
GATEWAY_ID="versicherung-hub-gateway"
SA_NAME="api-gateway-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
OPENAPI_SPEC="api_config.yaml"

echo "═══════════════════════════════════════════════════════"
echo " Versicherungs-Hub — API Gateway Deploy"
echo " Projekt: $PROJECT_ID | Region: $REGION"
echo "═══════════════════════════════════════════════════════"

# ── 1. Benötigte APIs aktivieren ──────────────────────────────────────────
echo ""
echo "▶ Schritt 1/7: APIs aktivieren..."
gcloud services enable \
  apigateway.googleapis.com \
  servicemanagement.googleapis.com \
  servicecontrol.googleapis.com \
  --project="$PROJECT_ID"

echo "  ✓ APIs aktiviert"

# ── 2. Service Account für API Gateway erstellen ──────────────────────────
echo ""
echo "▶ Schritt 2/7: Service Account erstellen..."

# Prüfen ob SA bereits existiert
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" &>/dev/null; then
  echo "  ✓ Service Account existiert bereits: $SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="API Gateway Service Account" \
    --project="$PROJECT_ID"
  echo "  ✓ Service Account erstellt: $SA_EMAIL"
fi

# App Engine Invoker-Rolle zuweisen (damit Gateway App Engine aufrufen darf)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker" \
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/appengine.appViewer" \
  --condition=None

echo "  ✓ IAM-Rollen zugewiesen"

# ── 3. API registrieren ───────────────────────────────────────────────────
echo ""
echo "▶ Schritt 3/7: API registrieren..."

if gcloud api-gateway apis describe "$API_ID" --project="$PROJECT_ID" &>/dev/null; then
  echo "  ✓ API existiert bereits: $API_ID"
else
  gcloud api-gateway apis create "$API_ID" \
    --project="$PROJECT_ID"
  echo "  ✓ API erstellt: $API_ID"
fi

# ── 4. API Config erstellen (OpenAPI Spec hochladen) ─────────────────────
echo ""
echo "▶ Schritt 4/7: API Config erstellen ($CONFIG_ID)..."
echo "  Spec: $OPENAPI_SPEC"

gcloud api-gateway api-configs create "$CONFIG_ID" \
  --api="$API_ID" \
  --openapi-spec="$OPENAPI_SPEC" \
  --project="$PROJECT_ID" \
  --backend-auth-service-account="$SA_EMAIL"

echo "  ✓ API Config erstellt: $CONFIG_ID"

# ── 5. Gateway deployen ───────────────────────────────────────────────────
echo ""
echo "▶ Schritt 5/7: Gateway deployen (kann 5-10 Min dauern)..."

if gcloud api-gateway gateways describe "$GATEWAY_ID" \
    --location="$REGION" \
    --project="$PROJECT_ID" &>/dev/null; then
  echo "  Gateway existiert — update auf neue Config..."
  gcloud api-gateway gateways update "$GATEWAY_ID" \
    --api="$API_ID" \
    --api-config="$CONFIG_ID" \
    --location="$REGION" \
    --project="$PROJECT_ID"
else
  gcloud api-gateway gateways create "$GATEWAY_ID" \
    --api="$API_ID" \
    --api-config="$CONFIG_ID" \
    --location="$REGION" \
    --project="$PROJECT_ID"
fi

echo "  ✓ Gateway deployed"

# ── 6. Gateway-URL ausgeben ───────────────────────────────────────────────
echo ""
echo "▶ Schritt 6/7: Gateway-URL abrufen..."

GATEWAY_HOSTNAME=$(gcloud api-gateway gateways describe "$GATEWAY_ID" \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(defaultHostname)")

GATEWAY_URL="https://${GATEWAY_HOSTNAME}"

echo ""
echo "═══════════════════════════════════════════════════════"
echo " ✅ Gateway erfolgreich deployed!"
echo ""
echo " Gateway-URL:  $GATEWAY_URL"
echo " API-ID:       $API_ID"
echo " Config:       $CONFIG_ID"
echo " SA:           $SA_EMAIL"
echo "═══════════════════════════════════════════════════════"

# ── 7. api_config.yaml automatisch mit Gateway-Hostname patchen ───────────
echo ""
echo "▶ Schritt 7/7: api_config.yaml mit Gateway-Hostname patchen..."

if [[ "$(uname)" == "Darwin" ]]; then
  # macOS
  sed -i '' "s|GATEWAY_HOSTNAME_NACH_DEPLOY|${GATEWAY_HOSTNAME}|g" "$OPENAPI_SPEC"
else
  # Linux
  sed -i "s|GATEWAY_HOSTNAME_NACH_DEPLOY|${GATEWAY_HOSTNAME}|g" "$OPENAPI_SPEC"
fi

echo "  ✓ api_config.yaml gepatcht (host: $GATEWAY_HOSTNAME)"
echo ""
echo "  NÄCHSTER SCHRITT: Config mit gepatchter Spec neu hochladen"
echo "  → Führe erneut aus: CONFIG_ID auf v2 erhöhen und deploy_gateway.sh neu starten"
echo ""
echo "  Health-Check:"
echo "  curl ${GATEWAY_URL}/api/health"
echo ""
