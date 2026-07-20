#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CampaignError {
    AlreadyInitialized = 1,
    DeadlinePassed = 2,
    DeadlineNotPassed = 3,
    GoalNotMet = 4,
    GoalWasMet = 5,
    AlreadyWithdrawn = 6,
    Unauthorized = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Creator,
    Goal,
    Deadline,
    Title,
    Description,
    Token,
    TotalPledged,
    Pledged(Address),
    Withdrawn,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    Active,
    GoalMet,
    Failed,
    Withdrawn,
}

#[contract]
pub struct CampaignContract;

#[contractimpl]
impl CampaignContract {
    pub fn initialize(
        env: Env,
        creator: Address,
        goal: i128,
        deadline: u64,
        title: String,
        description: String,
        token: Address,
    ) -> Result<(), CampaignError> {
        if env.storage().instance().has(&DataKey::Creator) {
            return Err(CampaignError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Creator, &creator);
        env.storage().instance().set(&DataKey::Goal, &goal);
        env.storage().instance().set(&DataKey::Deadline, &deadline);
        env.storage().instance().set(&DataKey::Title, &title);
        env.storage().instance().set(&DataKey::Description, &description);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::TotalPledged, &0i128);
        env.storage().instance().set(&DataKey::Withdrawn, &false);

        Ok(())
    }

    pub fn pledge(env: Env, contributor: Address, amount: i128) -> Result<(), CampaignError> {
        contributor.require_auth();

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() > deadline {
            return Err(CampaignError::DeadlinePassed);
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        // Transfer funds to this contract
        token_client.transfer(&contributor, &env.current_contract_address(), &amount);

        // Update total pledged
        let mut total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap();
        total += amount;
        env.storage().instance().set(&DataKey::TotalPledged, &total);

        // Update contributor balance
        let key = DataKey::Pledged(contributor.clone());
        let mut current_pledge: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        current_pledge += amount;
        env.storage().persistent().set(&key, &current_pledge);

        // Emit event
        env.events().publish(("CampaignEvents", "PledgeMade"), (contributor, amount, env.ledger().timestamp()));

        Ok(())
    }

    pub fn withdraw(env: Env, creator: Address) -> Result<(), CampaignError> {
        creator.require_auth();

        let stored_creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        if creator != stored_creator {
            return Err(CampaignError::Unauthorized);
        }

        let withdrawn: bool = env.storage().instance().get(&DataKey::Withdrawn).unwrap();
        if withdrawn {
            return Err(CampaignError::AlreadyWithdrawn);
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap();

        if env.ledger().timestamp() <= deadline {
            return Err(CampaignError::DeadlineNotPassed);
        }

        if total < goal {
            return Err(CampaignError::GoalNotMet);
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        token_client.transfer(&env.current_contract_address(), &creator, &total);
        env.storage().instance().set(&DataKey::Withdrawn, &true);

        env.events().publish(("CampaignEvents", "FundsWithdrawn"), (creator, total, env.ledger().timestamp()));

        Ok(())
    }

    pub fn claim_refund(env: Env, contributor: Address) -> Result<(), CampaignError> {
        // We don't necessarily require auth for claim_refund because it sends funds BACK to the contributor.
        // But for safety/parity, we will require auth.
        contributor.require_auth();

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap();

        if env.ledger().timestamp() <= deadline {
            return Err(CampaignError::DeadlineNotPassed);
        }

        if total >= goal {
            return Err(CampaignError::GoalWasMet);
        }

        let key = DataKey::Pledged(contributor.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount == 0 {
            return Ok(()); // Nothing to refund
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        token_client.transfer(&env.current_contract_address(), &contributor, &amount);
        env.storage().persistent().remove(&key);

        env.events().publish(("CampaignEvents", "RefundClaimed"), (contributor, amount, env.ledger().timestamp()));

        Ok(())
    }

    pub fn get_status(env: Env) -> CampaignStatus {
        if !env.storage().instance().has(&DataKey::Creator) {
            return CampaignStatus::Failed;
        }
        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let total: i128 = env.storage().instance().get(&DataKey::TotalPledged).unwrap();
        let withdrawn: bool = env.storage().instance().get(&DataKey::Withdrawn).unwrap();

        if withdrawn {
            return CampaignStatus::Withdrawn;
        }

        if env.ledger().timestamp() <= deadline {
            if total >= goal {
                return CampaignStatus::GoalMet;
            }
            return CampaignStatus::Active;
        } else {
            if total >= goal {
                return CampaignStatus::GoalMet;
            }
            return CampaignStatus::Failed;
        }
    }

    pub fn get_total_pledged(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalPledged).unwrap_or(0)
    }

    pub fn get_contributor_amount(env: Env, contributor: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Pledged(contributor)).unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
