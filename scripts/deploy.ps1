Write-Host "Building smart contracts..."
stellar contract build

# Generate a new identity for FundLoop
Write-Host "Generating fundloop-deployer identity..."
# soroban keys generate fundloop-deployer
# soroban keys fund fundloop-deployer --network testnet

Write-Host "Waiting for funding to settle..."
Start-Sleep -Seconds 5

# Deploy Campaign WASM to get its hash
Write-Host "Deploying Campaign WASM..."
$campaign_wasm_hash = stellar contract upload `
    --wasm target/wasm32v1-none/release/fundloop_campaign.wasm `
    --network testnet `
    --source fundloop-deployer

Write-Host "Campaign WASM Hash: $campaign_wasm_hash"

# Deploy Factory Contract
Write-Host "Deploying Factory Contract..."
$factory_id = stellar contract deploy `
    --wasm target/wasm32v1-none/release/fundloop_factory.wasm `
    --network testnet `
    --source fundloop-deployer

Write-Host "Factory Contract ID: $factory_id"

# Initialize Factory
Write-Host "Initializing Factory..."
soroban contract invoke `
    --id $factory_id `
    --network testnet `
    --source fundloop-deployer `
    -- `
    initialize `
    --campaign_wasm_hash $campaign_wasm_hash

# Create a Demo Campaign
Write-Host "Creating Demo Campaign..."

# SAC Address for Testnet Native XLM
$native_asset = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
$deployer_address = soroban keys address fundloop-deployer

# Set deadline to 1800000000
$deadline = 1800000000
$goal = [long]100000000 # 10 XLM (in stroops)

$create_output = stellar contract invoke `
    --id $factory_id `
    --network testnet `
    --source fundloop-deployer `
    -- `
    create_campaign `
    --creator $deployer_address `
    --goal $goal `
    --deadline $deadline `
    --title "FundLoop Demo Campaign" `
    --description "This is an authentic demo campaign created during deployment." `
    --token $native_asset `
    --salt 0000000000000000000000000000000000000000000000000000000000000001

# The output of create_campaign is the campaign address (wrapped in quotes usually)
$campaign_id = $create_output.Trim('""')
Write-Host "Demo Campaign ID: $campaign_id"

# Make a real 10 XLM pledge
Write-Host "Making a real pledge to generate a transaction hash..."
$pledge_amount = [long]100000000 # 10 XLM
$pledge_output = stellar contract invoke `
    --id $campaign_id `
    --network testnet `
    --source fundloop-deployer `
    -- `
    pledge `
    --contributor $deployer_address `
    --amount $pledge_amount

Write-Host "Deployment Complete!"
Write-Host "Save these details for your README:"
Write-Host "Deployer Address: $deployer_address"
Write-Host "Campaign WASM Hash: $campaign_wasm_hash"
Write-Host "Factory ID: $factory_id"
Write-Host "Demo Campaign ID: $campaign_id"

# Output contract addresses to JSON for the frontend
$addresses = @{
    factory = $factory_id
    campaignWasmHash = $campaign_wasm_hash
    network = "testnet"
}
$addresses | ConvertTo-Json | Out-File -FilePath deployed_addresses.json
Write-Host "Saved deployed_addresses.json"
