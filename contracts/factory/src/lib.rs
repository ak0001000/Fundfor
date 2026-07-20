#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, BytesN, Env, IntoVal, String, Vec,
};

#[contracttype]
pub enum DataKey {
    CampaignWasmHash,
    Campaigns,
}

#[contract]
pub struct FactoryContract;

#[contractimpl]
impl FactoryContract {
    pub fn initialize(env: Env, campaign_wasm_hash: BytesN<32>) {
        env.storage().instance().set(&DataKey::CampaignWasmHash, &campaign_wasm_hash);
        env.storage().instance().set(&DataKey::Campaigns, &Vec::<Address>::new(&env));
    }

    pub fn create_campaign(
        env: Env,
        creator: Address,
        goal: i128,
        deadline: u64,
        title: String,
        description: String,
        token: Address,
        salt: BytesN<32>,
    ) -> Address {
        creator.require_auth();

        let wasm_hash: BytesN<32> = env.storage().instance().get(&DataKey::CampaignWasmHash).unwrap();

        // Deploy the contract instance
        let campaign_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy(wasm_hash);

        // Initialize the deployed contract via cross-contract call
        env.invoke_contract::<()>(
            &campaign_address,
            &soroban_sdk::Symbol::new(&env, "initialize"),
            soroban_sdk::vec![
                &env,
                creator.into_val(&env),
                goal.into_val(&env),
                deadline.into_val(&env),
                title.into_val(&env),
                description.into_val(&env),
                token.into_val(&env),
            ],
        );

        // Store it in our registry
        let mut campaigns: Vec<Address> = env.storage().instance().get(&DataKey::Campaigns).unwrap();
        campaigns.push_back(campaign_address.clone());
        env.storage().instance().set(&DataKey::Campaigns, &campaigns);

        env.events().publish(
            (symbol_short!("factory"), symbol_short!("created")),
            campaign_address.clone(),
        );

        campaign_address
    }

    pub fn list_campaigns(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Campaigns).unwrap_or_else(|| vec![&env])
    }
}

#[cfg(test)]
mod test;
