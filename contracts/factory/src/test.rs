#![cfg(test)]

use crate::{FactoryContract, FactoryContractClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String, BytesN};

mod campaign {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/fundloop_campaign.wasm"
    );
}

#[test]
fn test_create_campaign() {
    let env = Env::default();
    let client = FactoryContractClient::new(&env, &env.register_contract(None, FactoryContract));

    let wasm_hash = env.deployer().upload_contract_wasm(campaign::WASM);
    client.initialize(&wasm_hash);

    let creator = Address::generate(&env);
    let token = Address::generate(&env);
    
    let title = String::from_str(&env, "Test Campaign");
    let description = String::from_str(&env, "Desc");
    
    env.ledger().set_timestamp(12345);
    
    let salt = BytesN::from_array(&env, &[0u8; 32]);
    let campaign_id = client.mock_all_auths().create_campaign(
        &creator,
        &1000i128,
        &99999u64,
        &title,
        &description,
        &token,
        &salt,
    );
    
    assert!(client.list_campaigns().contains(&campaign_id));
}
