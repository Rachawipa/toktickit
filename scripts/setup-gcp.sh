#!/usr/bin/env bash
# One-shot GCP setup for TokTickIT (Cloud Run + Cloud SQL + Artifact Registry + WIF).
# Run in Google Cloud Shell:  bash setup-gcp.sh
# Safe to re-run: existing resources are kept. Prints the GitHub variables at the end.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-southeast1}"
GH_REPO="${GH_REPO:?set GH_REPO, e.g. export GH_REPO=Rachawipa/toktickit}"
SERVICE="${SERVICE:-toktickit}"
AR_REPO="${AR_REPO:-toktickit}"
SQL_INSTANCE="${SQL_INSTANCE:-toktickit-db}"
[ -n "$PROJECT_ID" ] || { echo "Set PROJECT_ID"; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null
PN=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CONN="$PROJECT_ID:$REGION:$SQL_INSTANCE"
RUN_SA="toktickit-run@$PROJECT_ID.iam.gserviceaccount.com"
DEP_SA="gh-deployer@$PROJECT_ID.iam.gserviceaccount.com"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  sqladmin.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com

echo "==> Artifact Registry"
gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION"

echo "==> Cloud SQL (takes several minutes)"
gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 \
  || gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 \
       --tier=db-f1-micro --edition=ENTERPRISE --region="$REGION"
gcloud sql databases describe toktickit --instance="$SQL_INSTANCE" >/dev/null 2>&1 \
  || gcloud sql databases create toktickit --instance="$SQL_INSTANCE"

echo "==> Database user and secret"
DB_PASS=$(openssl rand -hex 16)
if gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx toktickit; then
  gcloud sql users set-password toktickit --instance="$SQL_INSTANCE" --password="$DB_PASS"
else
  gcloud sql users create toktickit --instance="$SQL_INSTANCE" --password="$DB_PASS"
fi
URL=$(printf 'postgresql://toktickit:%s@localhost/toktickit?host=/cloudsql/%s&schema=public' "$DB_PASS" "$CONN")
if gcloud secrets describe toktickit-database-url >/dev/null 2>&1; then
  printf '%s' "$URL" | gcloud secrets versions add toktickit-database-url --data-file=-
else
  printf '%s' "$URL" | gcloud secrets create toktickit-database-url --data-file=-
fi

echo "==> Service accounts and roles"
gcloud iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create toktickit-run
gcloud iam service-accounts describe "$DEP_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create gh-deployer
for r in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role="$r" --condition=None >/dev/null
done
for r in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEP_SA" --role="$r" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member="serviceAccount:$DEP_SA" --role=roles/iam.serviceAccountUser >/dev/null

echo "==> Workload Identity Federation (restricted to $GH_REPO)"
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers describe github-repo --location=global \
  --workload-identity-pool=github >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc github-repo \
       --location=global --workload-identity-pool=github \
       --issuer-uri=https://token.actions.githubusercontent.com \
       --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
       --attribute-condition="assertion.repository=='$GH_REPO'"
gcloud iam service-accounts add-iam-policy-binding "$DEP_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository/$GH_REPO" >/dev/null

cat <<OUT

================ DONE. Add these as GitHub repo VARIABLES ================
(Settings > Secrets and variables > Actions > Variables)
GCP_PROJECT_ID      = $PROJECT_ID
GCP_REGION          = $REGION
AR_REPOSITORY       = $AR_REPO
CLOUD_RUN_SERVICE   = $SERVICE
CLOUD_SQL_INSTANCE  = $CONN
WIF_PROVIDER        = projects/$PN/locations/global/workloadIdentityPools/github/providers/github-repo
WIF_SERVICE_ACCOUNT = $DEP_SA
Also create a GitHub Environment named: production
==========================================================================
OUT
