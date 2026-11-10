use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("TipVau1t11111111111111111111111111111111111");

#[program]
pub mod tip_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_bps: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.fee_bps = fee_bps;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.vault_tokens.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
        )?;
        vault.total = vault.total + amount;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let fee = amount * vault.fee_bps / 10_000;
        let seeds: &[&[u8]] = &[b"vault", vault.authority.as_ref(), &[vault.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: vault.to_account_info(),
                },
                &[seeds],
            ),
            amount - fee,
        )?;
        vault.total -= amount;
        Ok(())
    }

    pub fn notify(ctx: Context<Notify>, data: Vec<u8>) -> Result<()> {
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.hook_program.key(),
            accounts: vec![],
            data,
        };
        invoke(&ix, &[ctx.accounts.hook_program.clone()])?;
        Ok(())
    }

    pub fn close_vault(_ctx: Context<CloseVault>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = authority, space = 8 + Vault::SIZE, seeds = [b"vault", authority.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault", vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub depositor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub vault_tokens: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    /// CHECK: the vault authority
    pub authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Notify<'info> {
    /// CHECK: notification hook
    pub hook_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut, close = authority, has_one = authority, seeds = [b"vault", authority.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub fee_bps: u64,
    pub total: u64,
    pub bump: u8,
}

impl Vault {
    pub const SIZE: usize = 32 + 8 + 8 + 1;
}
