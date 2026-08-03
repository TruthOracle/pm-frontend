# Deploy TruthOracle DAML Contracts on Canton

Step-by-step guide to build the DAR and deploy it on Canton (local node or Canton Network).

---

## Quick: build & upload to a remote participant (npm scripts)

For the Cantor8 zkpc (MainNet) node — or any other remote participant exposing the JSON Ledger API with Keycloak client_credentials auth — use the npm scripts from the repo root.

1. Fill these in `.env` (placeholders are pre-populated for the zkpc node; client id/secret come from Cantor8):

   ```
   ZKPC_LEDGER_API_URL=https://api.validator.main.zkpc.cantor8.tech/api/ledger
   ZKPC_KEYCLOAK_URL=https://auth.main.zkpc.cantor8.tech
   ZKPC_KEYCLOAK_REALM=master
   ZKPC_KEYCLOAK_CLIENT_ID=<from Cantor8>
   ZKPC_KEYCLOAK_CLIENT_SECRET=<from Cantor8>
   ```

2. Build the DAR:

   ```
   npm run dars:build
   ```

   Produces `daml/.daml/dist/truthoracle-1.0.0.dar`.

3. Upload it:

   ```
   npm run dars:upload
   ```

   On success the script prints the participant's response (empty `{}` for `POST /v2/packages` in Canton 3.4). To upload a different DAR, pass a path: `npm run dars:upload -- path/to/file.dar`. Run `npm run dars:upload -- --help` for details.

4. **Get the package ID** (the upload response doesn't contain it — Canton 3.4 returns `{}`). The ID lives inside the DAR's `META-INF/MANIFEST.MF` as the `Main-Dalf` suffix:

   ```
   # With the Daml SDK on PATH (recommended):
   daml damlc inspect-dar daml/.daml/dist/truthoracle-1.0.0.dar --json | jq -r .main_package_id

   # Or read the manifest directly (no SDK required — MANIFEST.MF wraps at 72 chars
   # with leading-space continuation, so strip whitespace before parsing):
   unzip -p daml/.daml/dist/truthoracle-1.0.0.dar META-INF/MANIFEST.MF \
     | tr -d '\r\n ' \
     | grep -oE 'Main-Dalf:[^/]+' \
     | sed -E 's/.*-([0-9a-f]{64})$/\1/'
   ```

   Both print the 64-hex package ID (e.g. `193d7a7edc7229ab83e61452889dbfb066fa6fd497f1e847d3cb6bef7a27df34`). Set it in the repo-root `.env` as `VITE_TRUTHORACLE_PACKAGE_ID=…` so the frontend's `frontend/constants.ts` fallback is overridden, and the participant resolves choices to the freshly uploaded package.

   To confirm the participant has it, `curl -H "Authorization: Bearer $TOKEN" "$LEDGER_API/v2/packages"` returns `{"packageIds":[…]}` — the new ID will be in that list (the endpoint doesn't label them, so cross-reference by the ID you extracted above).

---

## Quick deploy with DPM (local sandbox)

From the `daml/` directory after building:

**Option 1 – Start sandbox and upload DAR in one go**

```bash
cd daml
dpm sandbox --dar .daml/dist/truthoracle-1.0.0.dar
```

Sandbox will start (Ledger API on port **6865**, Admin API on **6866**) and your DAR will be uploaded automatically.

**Option 2 – Start sandbox, then upload via console**

1. Start the sandbox (in one terminal):
   ```bash
   cd daml
   dpm sandbox
   ```
2. In another terminal, open the Canton console:
   ```bash
   dpm canton-console
   ```
3. In the console, upload the DAR (use the full path to your DAR):
   ```bash
   sandbox.dars.upload("/Users/sachin/Desktop/TruthOracle/canton/truthoracle-frontend-and-contracts/daml/.daml/dist/truthoracle-1.0.0.dar")
   ```
4. Optional: list DARs and allocate parties:
   ```bash
   sandbox.dars.list()
   sandbox.parties.allocate("admin", "Admin Party")
   ```
5. Type `exit` to leave the console.

Point your frontend/Ledger API client at **localhost:6865** to use the sandbox.

---

## Prerequisites

- **DPM with SDK 3.4.10** (matches `daml.yaml`). Install: [DPM install](https://docs.digitalasset.com/build/3.4/dpm/manual-install.html).
- **Canton** – either:
  - **Local**: DPM sandbox (`dpm sandbox`) or Canton Open Source, or
  - **Canton Network TestNet**: access to a participant node (validator or via a provider).

---

## Step 1: Build the DAR

From the `daml/` directory:

```bash
cd daml
dpm build
```

This produces a DAR under `.daml/dist/`:

- **Path**: `daml/.daml/dist/truthoracle-1.0.0.dar`
- **Name**: `truthoracle` (from `daml.yaml`)

Optional: run tests before deploying:

```bash
dpm test
```

---

## Step 2: Choose Deployment Target

### Option A – Local Canton (dev / testing)

Use a local Canton participant (with or without a sync domain).

1. **Get Canton**  
   With DPM (SDK 3.4), start a local Canton sandbox (see **Quick deploy with DPM** above):
   ```bash
   dpm sandbox
   ```
   Or download Canton Open Source from [releases](https://github.com/digital-asset/daml/releases) and use a 3.4.x-compatible release.

2. **Start a participant**  
   If using a Canton release directory:
   ```bash
   ./bin/canton -c config/participant.conf
   ```
   Or use the **sandbox** config (participant + domain, in-memory):
   ```bash
   ./bin/canton -c config/sandbox.conf
   ```
   See [Canton installation](https://docs.daml.com/canton/usermanual/installation.html) for your topology.

3. **Connect participant to a sync domain** (if not using sandbox)  
   In the participant console:
   ```bash
   participant.domains.connect_local(mydomain)
   ```
   Or for a remote domain, use `participant.domains.connect(...)` with the domain URL and certs as in the Canton docs.

4. **Upload the DAR** (Step 3 below) using the same participant’s console.

### Option B – Canton Network TestNet

To deploy on **TestNet** you need a **participant node** connected to Canton Network. You can either run your own validator or use a hosted participant (Node-as-a-Service).

#### Path 1: Hosted participant (Node-as-a-Service)

Easiest if you don’t want to operate infrastructure:

- **Canton Nodes** – [cantonnodes.com](https://www.cantonnodes.com/): free public API and paid plans; use their Ledger API endpoint and (if provided) Admin API or upload flow for your DAR.
- **Other providers** – Check [Canton Network connect](https://www.canton.network/connect) and [developer resources](https://www.canton.network/developer-resources) for current Node-as-a-Service or app-developer offerings.

Typical flow:

1. Sign up and get a **TestNet participant** (Ledger API URL, optional Admin API, auth if required).
2. Upload your DAR using their recommended method (web UI, API, or Canton console if they give you console access).
3. Allocate parties via their UI/API/console.
4. Point your app at their **Ledger API** host/port and party IDs.

#### Path 2: Run your own validator on TestNet

For full control you run a validator that connects to the TestNet sync domain:

1. **Request access** – [sync.global](https://sync.global/) (e.g. validator request / Tokenomics Committee approval). You’ll need a **sponsoring Super Validator (SV)**.
2. **Provide egress IP** – One stable egress IP per network; allowlisting by SVs can take a few days.
3. **Get onboarding secret** – One-time secret from your SV (often valid ~48 hours).
4. **Deploy the node** – Use the deployment package from your SV (e.g. Docker Compose or Kubernetes). Docs: [Validator onboarding](https://docs.sync.global/validator_operator/validator_onboarding.html), [Docker Compose deployment](https://docs.test.global.canton.network.sync.global/validator_operator/validator_compose.html).
5. **Connect to TestNet** – Start your participant; it will join the TestNet sync domain using the onboarding secret and config from your SV.
6. **Upload DAR** – Use the Canton console (local or remote) for your participant, then run the same upload and party steps as below (Step 3 and Step 4).

Once you have a TestNet participant (hosted or your own), **upload the DAR** and **configure your app** as in Step 3 and Step 4 below. Use your participant’s Ledger API host/port (and Admin API if you have it) instead of localhost.

---

## Step 3: Upload the DAR to the Participant

You need to upload **one DAR** (TruthOracle is a single project). If you later add more DARs (e.g. dependencies), upload in **dependency order**.

### Via Canton Console

1. Start the Canton console (embedded with the participant or [remote](https://docs.daml.com/canton/usermanual/installation.html#using-an-embedded-synchronization-domain)).
2. Use the participant reference from your config (e.g. `participant1`, `participant2`, or your node name).
3. Upload the DAR (adjust path to your built DAR):

   ```bash
   participant1.dars.upload("/full/path/to/truthoracle-frontend-and-contracts/daml/.daml/dist/truthoracle-1.0.0.dar")
   ```

   Or copy the DAR into the Canton bundle and use a relative path, e.g.:

   ```bash
   participant1.dars.upload("dars/truthoracle-1.0.0.dar")
   ```

4. Note the returned **hash**; the DAR is uploaded and (by default) **vetted**, so contracts from this package can be used immediately.

Optional checks:

```bash
participant1.dars.list()
participant1.dars.list_contents("<hash-from-upload>")
participant1.packages.list()
```

### Via Ledger API

You can also upload the DAR using the Ledger API **PackageService** (e.g. from a script or your backend). See [Ledger API – Package Service](https://docs.daml.com/app-dev/grpc/proto-docs.html#com-daml-ledger-api-v1-packageservice).

---

## Step 4: Parties and Application Config

- **Allocate parties** on the participant as required by your app (admin, market creators, users, etc.). Use the Canton console, e.g.:
  ```bash
  participant1.parties.allocate("admin", "Admin Party")
  participant1.parties.allocate("marketCreator", "Market Creator")
  ```
- **Configure the frontend / backend** to use this participant’s **Ledger API** (host, port, TLS, JWT if enabled) and the correct party IDs. Your `blockend/cantonService.js` and frontend Canton client should point to this participant.

---

## Step 5: Verify

- In the Canton console, create or query a contract from a TruthOracle template (e.g. `PredictionMarket`) to confirm the package is active.
- Use the TruthOracle frontend: connect the Canton wallet to the same participant and run a flow (e.g. view markets, Canton Coin balance/transfer) to confirm end-to-end.

---

## Summary Checklist

| Step | Action |
|------|--------|
| 1 | `cd daml && dpm build` → get `daml/.daml/dist/truthoracle-1.0.0.dar` |
| 2 | Start Canton participant (local or TestNet) and connect to a sync domain |
| 3 | In Canton console: `participant1.dars.upload("path/to/truthoracle-1.0.0.dar")` |
| 4 | Allocate parties; point app and frontend to participant Ledger API |
| 5 | Test with console and/or UI |

---

## Connecting to a remote participant (e.g. TestNet)

If your participant is remote, connect the Canton console with host/port (and TLS if required):

```bash
dpm canton-console --help   # see --participant-host, --participant-port, etc.
```

Then in the console use your participant’s name (e.g. `participant1`) instead of `sandbox` when uploading DARs and allocating parties.

---

## References

- [Canton installation & setup](https://docs.daml.com/canton/usermanual/installation.html)
- [Manage DARs and packages](https://docs.daml.com/canton/usermanual/packagemanagement.html)
- [Canton Network](https://www.canton.network/) · [Connect / TestNet](https://www.canton.network/connect) · [Developer resources](https://www.canton.network/developer-resources)
- [Sync.global – Validator onboarding](https://docs.sync.global/validator_operator/validator_onboarding.html)
- [Canton Nodes (hosted API)](https://www.cantonnodes.com/)
- [DAML SDK installation](https://docs.daml.com/getting-started/installation.html)
