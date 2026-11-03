use anchor_lang::prelude::*;

declare_id!("Vau1t11111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let vault = &mut ctx.accounts.vault;
        vault.amount = vault.amount.checked_add(amount).ok_or(VaultError::Overflow)?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.amount = vault.amount.checked_sub(amount).ok_or(VaultError::Insufficient)?;
        **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.try_borrow_mut_lamports()? += amount;
        Ok(())
    }

    pub fn close(_ctx: Context<CloseVault>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    /// CHECK: receives the lamports
    #[account(mut)]
    pub authority: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut, close = receiver)]
    pub vault: Account<'info, VaultState>,
    /// CHECK: any account
    #[account(mut)]
    pub receiver: AccountInfo<'info>,
    pub owner: Signer<'info>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum VaultError {
    ZeroAmount,
    Overflow,
    Insufficient,
}
