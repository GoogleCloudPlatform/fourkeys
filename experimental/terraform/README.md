# Experimental Terraform setup

This folder contains terraform scripts to provision all of the infrastructure in a Four Keys GCP project. 

**DO NOT USE!** It's very early and very incomplete. (Though: holler if you want to contribute!)

## How to use
1. run `setup.sh`; this will:
  * create a project for four keys
  * purge all terraform state [useful during tf development]
  * build the event-handler container using Cloud Build
    * _(this is done outside of Terraform b/c local-exec is messy)_
  * create a `terraform.tfvars` file
  * invoke terraform
1. run the following commands to retrieve values needed for your SCM:
  * ```
    echo `terraform output -raw event-handler-endpoint`
    echo `terraform output -raw event-handler-secret`
    ```


Current functionality (GitHub+CloudBuild only):
- Create a GCP project (outside of terraform)
- Build the event-handler container image and push to GCR [TODO: use AR instead]
- Deploy the event-handler container as a Cloud Run service
- Emit the event-handler endpoint as an output
- Create and store webhook secret
- Emit the secrfet as an output
- Set up (some of) BigQuery

TODO:
- (The rest of the VCSes and CI/CD systems)
- Create pubsub
- Build and deploy bigquery workers
- Establish BigQuery data transfer
- Populate Data Studio dashboard
- Helloworld project creation
- (much else)

ALSO:
- provide user inputs for VCS system, CI/CD system, and GCP project settings

Open questions:
- What's an elegant way to support those user inputs (VCS, CI/CD) as conditionals in the TF?
- Should we create a service account and run TF as that, or keep the current process of using application default credentials of the user who invokes the script?

Answered questions:
- Should we create the GCP project in terraform? No. The auth gets really complicated, especially when considering that the project may or may not be in an organization and/or folder