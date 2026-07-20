#![cfg(test)]

use crate::{CampaignContract, CampaignContractClient, CampaignError, CampaignStatus};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String, token};

fn setup_test<'a>() -> (Env, CampaignContractClient<'a>, Address, Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();
    
    let creator = Address::generate(&env);
    let backer = Address::generate(&env);
    
    // Deploy contract
    let contract_id = env.register_contract(None, CampaignContract);
    let client = CampaignContractClient::new(&env, &contract_id);
    
    // Register mock token (SAC)
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::Client::new(&env, &token_contract_id);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract_id);
    
    // Mint tokens to backer
    token_admin_client.mint(&backer, &100_000);
    
    // Initialize campaign
    let goal = 10_000;
    let deadline = 100;
    
    env.ledger().set_timestamp(10);
    
    client.initialize(
        &creator,
        &goal,
        &deadline,
        &String::from_str(&env, "Test Campaign"),
        &String::from_str(&env, "Description"),
        &token_contract_id,
    );
    
    (env, client, creator, backer, token_client, token_admin_client)
}

#[test]
fn test_successful_pledge() {
    let (env, client, _creator, backer, token_client, _) = setup_test();
    
    assert_eq!(client.get_total_pledged(), 0);
    assert_eq!(client.get_status(), CampaignStatus::Active);
    
    client.mock_all_auths().pledge(&backer, &5_000);
    
    assert_eq!(client.get_total_pledged(), 5_000);
    assert_eq!(client.get_contributor_amount(&backer), 5_000);
    assert_eq!(token_client.balance(&client.address), 5_000);
    assert_eq!(token_client.balance(&backer), 95_000);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #2)")]
fn test_pledge_fails_if_deadline_passed() {
    let (env, client, _creator, backer, _, _) = setup_test();
    
    env.ledger().set_timestamp(101);
    
    client.mock_all_auths().pledge(&backer, &5_000);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #3)")]
fn test_withdraw_fails_if_deadline_not_passed() {
    let (env, client, creator, backer, _, _) = setup_test();
    
    client.mock_all_auths().pledge(&backer, &10_000); // Goal met
    
    // Timestamp is still 10, deadline is 100
    client.mock_all_auths().withdraw(&creator);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #4)")]
fn test_withdraw_fails_if_goal_not_met() {
    let (env, client, creator, backer, _, _) = setup_test();
    
    client.mock_all_auths().pledge(&backer, &5_000); // Goal NOT met
    
    env.ledger().set_timestamp(101); // Deadline passed
    
    client.mock_all_auths().withdraw(&creator);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #7)")]
fn test_unauthorized_withdraw_fails() {
    let (env, client, _creator, backer, _, _) = setup_test();
    
    client.mock_all_auths().pledge(&backer, &10_000); // Goal met
    env.ledger().set_timestamp(101); // Deadline passed
    
    let fake_creator = Address::generate(&env);
    
    client.mock_all_auths().withdraw(&fake_creator);
}

#[test]
fn test_withdraw_succeeds_after_goal_met_and_deadline_passed() {
    let (env, client, creator, backer, token_client, _) = setup_test();
    
    client.mock_all_auths().pledge(&backer, &10_000); // Goal met
    env.ledger().set_timestamp(101); // Deadline passed
    
    assert_eq!(client.get_status(), CampaignStatus::GoalMet);
    
    client.mock_all_auths().withdraw(&creator);
    
    assert_eq!(client.get_status(), CampaignStatus::Withdrawn);
    assert_eq!(token_client.balance(&creator), 10_000);
    assert_eq!(token_client.balance(&client.address), 0);
}

#[test]
fn test_refund_succeeds_when_goal_failed() {
    let (env, client, _creator, backer, token_client, _) = setup_test();
    
    client.mock_all_auths().pledge(&backer, &5_000); // Goal failed
    env.ledger().set_timestamp(101); // Deadline passed
    
    assert_eq!(client.get_status(), CampaignStatus::Failed);
    
    client.mock_all_auths().claim_refund(&backer);
    
    // Backer gets 5000 back, total balance 100_000 again
    assert_eq!(token_client.balance(&backer), 100_000);
    assert_eq!(token_client.balance(&client.address), 0);
    assert_eq!(client.get_contributor_amount(&backer), 0);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #5)")]
fn test_refund_fails_when_goal_was_met() {
    let (env, client, _creator, backer, _, _) = setup_test();
    
    client.mock_all_auths().pledge(&backer, &10_000); // Goal met
    env.ledger().set_timestamp(101); // Deadline passed
    
    client.mock_all_auths().claim_refund(&backer);
}
