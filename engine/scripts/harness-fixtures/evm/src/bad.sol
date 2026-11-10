// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

contract Bad is UUPSUpgradeable {
    function initialize(address o) external { owner = o; }
    function auth() external { require(tx.origin == owner); }
    function run(address t, bytes calldata d) external { t.delegatecall(d); }
    function kill() external { selfdestruct(payable(msg.sender)); }
    function pay(uint256 a) external { (bool ok, ) = msg.sender.call{value: a}(""); payable(msg.sender).transfer(a); }
    function pull(address token, uint256 a) external { IERC20(token).transferFrom(msg.sender, address(this), a); }
    function claim(uint256 a, uint8 v, bytes32 r, bytes32 s) external { address who = ecrecover(keccak256(abi.encodePacked(msg.sender, a)), v, r, s); }
    function draw() external view returns (uint256) { return block.timestamp % 2; }
    function add(uint256 a) external { unchecked { total += a; } }
    function raw() external { assembly { sstore(0, 1) } }
}
