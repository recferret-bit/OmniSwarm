// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Idioms the lead scan must not flag.
contract Good {
    using SafeERC20 for IERC20;

    function auth() external view { require(msg.sender == owner, "owner only"); }
    function pull(IERC20 token, uint256 amount) external { token.safeTransferFrom(msg.sender, address(this), amount); }
    function push(IERC20 token, address to, uint256 amount) external onlyOwner { token.safeTransfer(to, amount); }
    function add(uint256 amount) external { total = total + amount; }
}
