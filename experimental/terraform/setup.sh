#!/bin/bash
# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -eEuo pipefail

RANDOM_IDENTIFIER=$((RANDOM%999999))
export PARENT_PROJECT=$(gcloud config get-value project)
export FOURKEYS_PROJECT=$(printf "fourkeys-%06d" $RANDOM_IDENTIFIER)
export FOURKEYS_REGION=us-central1
# export HELLOWORLD_PROJECT=$(printf "helloworld-%06d" $RANDOM_IDENTIFIER)
# export HELLOWORLD_REGION=us-central
# export HELLOWORLD_ZONE=${HELLOWORLD_REGION}1-a
export PARENT_FOLDER=$(gcloud projects describe ${PARENT_PROJECT} --format="value(parent.id)")
export BILLING_ACCOUNT=$(gcloud beta billing projects describe ${PARENT_PROJECT} --format="value(billingAccountName)" || sed -e 's/.*\///g')


# TODO: Allow user to specify project name (or choose current)
echo "Creating new project for Four Keys Dashboard..."
gcloud projects create ${FOURKEYS_PROJECT} --folder=${PARENT_FOLDER}
gcloud beta billing projects link ${FOURKEYS_PROJECT} --billing-account=${BILLING_ACCOUNT}
export PARENT_PROJECTNUM=$(gcloud projects describe ${PARENT_PROJECT} --format='value(projectNumber)')

# FOR DEVELOPMENT ONLY: purge all TF state
echo "Purging TF state [FOR DEVELOPMENT ONLY]"
rm -rf .terraform terraform.tfstate* terraform.tfvars

echo "Enabling services for container build and storage"
gcloud services enable cloudbuild.googleapis.com --project=${PARENT_PROJECT}
gcloud services enable containerregistry.googleapis.com --project=${FOURKEYS_PROJECT}
gcloud projects add-iam-policy-binding ${FOURKEYS_PROJECT} --member="serviceAccount:${PARENT_PROJECTNUM}@cloudbuild.gserviceaccount.com" --role="roles/storage.admin"

# build containers for Cloud Run (using parent project) and stash in the fourkeys project
echo "building event-handler container"
gcloud builds submit ../../event_handler --tag=gcr.io/${FOURKEYS_PROJECT}/event-handler --project=${PARENT_PROJECT}
echo "building github-parser container" # [TODO: user's choice of VCS]
gcloud builds submit ../../bq_workers/github_parser --tag=gcr.io/${FOURKEYS_PROJECT}/github-parser --project=${PARENT_PROJECT}

# create a tfvars file
cat > terraform.tfvars <<EOF
google_project_id = "${FOURKEYS_PROJECT}"
google_region = "${FOURKEYS_REGION}"
EOF

echo "Invoking Terraform on project ${FOURKEYS_PROJECT}..."
terraform init
terraform apply --auto-approve