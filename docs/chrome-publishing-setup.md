# Chrome publishing setup

Checked 2026-11-05 against [Google's federation instructions](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) and [service-account integration](https://developer.chrome.com/docs/webstore/service-accounts). These steps configure access; they do not submit the extension for review. Do not create a service-account key.

## Publishing prerequisite

Before publishing, apply the condition in step 3 to the existing Google Cloud provider. The repository’s current OIDC subject prefix and workflow reference use `syllune`; a provider condition using a different repository name will reject authentication. The GitHub values were verified on 2026-11-13. The live Google Cloud condition could not be inspected or updated from this environment because Google Cloud credentials were unavailable. Run the GET-only Store check after the policy update before releasing. Keep existing service-account and pool resource IDs.

## 1. Create the draft store item

In the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole), finish developer registration if prompted, select **Add new item**, and upload the agent-prepared Chrome extension ZIP. Leave the item as a draft. Do not select Submit for review. See [Google's upload instructions](https://developer.chrome.com/docs/webstore/publish).

Copy the item's **Item ID** and, under **Publisher → Settings**, the **Publisher ID**. In GitHub **Settings → Secrets and variables → Actions → Variables**, add repository variables `CHROME_EXTENSION_ID` and `CHROME_PUBLISHER_ID`, respectively.

## 2. Keep the service account, without a key

In [Google Cloud Console](https://console.cloud.google.com/), select the publishing project. Under **APIs & Services → Library**, enable these APIs if not already enabled:

- Chrome Web Store API (`chromewebstore.googleapis.com`)
- Identity and Access Management API (`iam.googleapis.com`)
- Cloud Resource Manager API (`cloudresourcemanager.googleapis.com`)
- IAM Service Account Credentials API (`iamcredentials.googleapis.com`)
- Security Token Service API (`sts.googleapis.com`)

Under **IAM & Admin → Service Accounts**, create `read-aloud-publisher` or open the existing publishing account. Do not grant it broad project roles. Copy its email. In the Chrome Developer Dashboard's **Account** section, authorize that service-account email. Add the email to GitHub as repository variable `CHROME_SERVICE_ACCOUNT_EMAIL`.

## 3. Create the GitHub identity provider

In Google Cloud, open **IAM & Admin → Workload Identity Federation**, then **Create pool**.

1. Name the pool `read-aloud-github` and keep it enabled.
2. Add an **OpenID Connect (OIDC)** provider named `github`.
3. Set issuer URL to `https://token.actions.githubusercontent.com`.
4. Select **Default audience**.
5. Add these attribute mappings. The right column is the value expression:

| Google attribute | Expression |
| --- | --- |
| `google.subject` | `assertion.sub` |
| `attribute.repository_id` | `assertion.repository_id` |
| `attribute.repository_owner_id` | `assertion.repository_owner_id` |
| `attribute.ref` | `assertion.ref` |
| `attribute.event_name` | `assertion.event_name` |
| `attribute.job_workflow_ref` | `assertion.job_workflow_ref` |

6. Under **Attribute conditions**, paste:

```text
attribute.repository_id == '1438871817' &&
attribute.repository_owner_id == '102549834' &&
google.subject == 'repo:Fidasek009@102549834/syllune@1438871817:environment:stores' &&
attribute.job_workflow_ref == 'Fidasek009/syllune/.github/workflows/cd.yml@' + attribute.ref &&
((attribute.event_name == 'workflow_dispatch' && attribute.ref == 'refs/heads/main') ||
 (attribute.event_name == 'push' && attribute.ref.startsWith('refs/tags/v')))
```

7. Save the pool/provider. The numeric IDs were read from GitHub for this repository and owner; they protect against a deleted repository/account name being reused. This repository's OIDC settings API reports `use_immutable_subject: true` and prefix `repo:Fidasek009@102549834/syllune@1438871817`. The subject must include those IDs; the older names-only subject will be rejected. See [GitHub's immutable subject documentation](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims). The condition permits only our reusable CD workflow in the `stores` environment, called by a manual main-branch check or a version-tag push. Strict stable SemVer is additionally enforced by the release workflow.

## 4. Allow the identity to use the service account

Open the pool and select **Grant access**. Choose **Grant access using Service Account impersonation**, select the publishing service account, and restrict access to identities matching:

```text
Attribute: attribute.repository_id
Value:     1438871817
```

This grants **Workload Identity User** (`roles/iam.workloadIdentityUser`) on that service account to the matching pool identities. Do not grant access to the entire pool. A project-wide Owner/Editor role and a service-account key are unnecessary. If the console asks for a principal explicitly, use:

```text
principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/read-aloud-github/attribute.repository_id/1438871817
```

Replace `PROJECT_NUMBER` with the numeric Google Cloud project number shown on the pool. This is distinct from the textual project ID. Grant that principal **Workload Identity User** on the publishing service account.

## 5. Save the provider identifier in GitHub

Open the `github` provider's details and copy its full resource name:

```text
projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/read-aloud-github/providers/github
```

Add it as GitHub repository variable `CHROME_WORKLOAD_IDENTITY_PROVIDER`. Do not prepend `https://` or `//iam.googleapis.com/`.

Chrome now uses exactly four repository variables: `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_SERVICE_ACCOUNT_EMAIL`, and `CHROME_WORKLOAD_IDENTITY_PROVIDER`. No Chrome environment secrets are required. Do not add `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` or `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`; the workflow no longer reads them.

## 6. Finish the GitHub environment setup

Create the GitHub environment **stores** under **Settings → Environments**. Permit deployment branch `main` and deployment tags `v*`. Leave required reviewers and wait timers disabled for unattended releases. Protect main and release-tag creation through repository rules so only trusted changes can run publishing jobs.

Allow a few minutes for Google's IAM changes to propagate. Stop here during setup. After the workflow changes reach main and the owner asks to validate credentials, **Actions → Store check → Run workflow → main → chrome** authenticates without uploading. Adding variables does not itself run a workflow. On 2026-11-05, [Store check attempt 3](https://github.com/Fidasek009/syllune/actions/runs/42102496965/attempts/3) passed CI, federated token generation and WXT's Chrome authentication check. No extension was uploaded or submitted; this verifies credentials/item access, not live publication or store approval. Firefox setup and release acceptance remain documented in [releasing.md](releasing.md).

If a key was already created for this integration, remove it from the service account's Keys tab and remove its old GitHub secret after confirming it has no other consumer. Deleting the local JSON alone does not revoke the key.
