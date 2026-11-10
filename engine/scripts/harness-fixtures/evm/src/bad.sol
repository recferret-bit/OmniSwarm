// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

contract Bad is UUPSUpgradeable, ReentrancyGuard, ERC4626 {
    uint256[50] private __gap;
    function initialize(address o) external { owner = o; }
    function auth() external { require(tx.origin == owner); }
    function onlyEoa() external { require(msg.sender == tx.origin); require(msg.sender.code.length == 0); }
    function run(address t, bytes calldata d) external { t.delegatecall(d); }
    function kill() external { selfdestruct(payable(msg.sender)); }
    function pay(uint256 a) external { (bool ok, ) = msg.sender.call{value: a}(""); payable(msg.sender).transfer(a); }
    function pull(address token, uint256 a) external { IERC20(token).transferFrom(msg.sender, address(this), a); }
    function mintTo(address to, uint256 id) external { _safeMint(to, id); }
    function claim(uint256 a, uint8 v, bytes32 r, bytes32 s) external { address who = ecrecover(keccak256(abi.encodePacked(msg.sender, a)), v, r, s); }
    function approveBySig(address t, uint256 a, uint256 d, uint8 v, bytes32 r, bytes32 s) external { IERC20Permit(t).permit(msg.sender, address(this), a, d, v, r, s); }
    function price() external view returns (uint256) { (, int256 answer, , , ) = feed.latestRoundData(); return uint256(answer); }
    function spot() external view returns (uint256) { (uint112 a, uint112 b, ) = pair.getReserves(); return token.balanceOf(address(this)) * a / b; }
    function fee(uint256 amount) external view returns (uint256) { return amount / 10000 * feeBps; }
    function narrow(uint256 big) external pure returns (uint128) { return uint128(big); }
    function draw() external view returns (uint256) { return block.timestamp % 2; }
    function add(uint256 a) external { unchecked { total += a; } }
    function payAll() external { for (uint256 i = 0; i < payees.length; i++) { pay(1); } }
    function raw() external { assembly { sstore(0, 1) } }
}
