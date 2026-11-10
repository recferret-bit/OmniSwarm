// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IPair {
    function getReserves() external view returns (uint112, uint112, uint32);
}

/// Pooled tips: supporters deposit a token and receive shares; creators are paid from the pool.
contract TipShares {
    IERC20 public asset;
    AggregatorV3Interface public feed;
    IPair public pair;
    address public owner;
    address public implementation;
    bool private initialized;

    uint256 public totalShares;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public nonces;
    mapping(address => uint96) public rewards;
    address[] public creators;

    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address creator,uint256 amount,uint256 nonce,uint256 deadline)");

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    modifier onlyHuman() {
        require(msg.sender == tx.origin, "no contracts");
        _;
    }

    function initialize(IERC20 _asset, AggregatorV3Interface _feed, IPair _pair) external {
        require(!initialized, "already initialized");
        initialized = true;
        owner = msg.sender;
        asset = _asset;
        feed = _feed;
        pair = _pair;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"), keccak256("TipShares"), block.chainid, address(this)));
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function deposit(uint256 assets) external onlyHuman returns (uint256 minted) {
        minted = totalShares == 0 ? assets : assets * totalShares / totalAssets();
        require(asset.transferFrom(msg.sender, address(this), assets), "transfer failed");
        shares[msg.sender] += minted;
        totalShares += minted;
    }

    function withdraw(uint256 shareAmount) external returns (uint256 assets) {
        assets = shareAmount * totalAssets() / totalShares;
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        require(asset.transfer(msg.sender, assets), "transfer failed");
    }

    function assetPriceUsd() public view returns (uint256) {
        (, int256 answer, , , ) = feed.latestRoundData();
        return uint256(answer);
    }

    function spotPrice() public view returns (uint256) {
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        return uint256(reserve1) * 1e18 / reserve0;
    }

    function borrowLimit(address account) public view returns (uint256) {
        return shares[account] * spotPrice() / 1e18;
    }

    function feeFor(uint256 amount, uint256 bps) public pure returns (uint256) {
        return amount / 10000 * bps;
    }

    function recordTip(address creator, uint256 amount) external onlyOwner {
        if (rewards[creator] == 0) creators.push(creator);
        rewards[creator] += uint96(amount);
    }

    function payAll() external {
        for (uint256 i = 0; i < creators.length; i++) {
            address creator = creators[i];
            uint256 owed = rewards[creator];
            rewards[creator] = 0;
            require(asset.transfer(creator, owed), "transfer failed");
        }
    }

    function claimWithSig(address creator, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "expired");
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, creator, amount, nonces[creator]++, deadline));
        address signer = ecrecover(keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash)), v, r, s);
        require(signer != address(0) && signer == owner, "bad signature");
        rewards[creator] -= uint96(amount);
        require(asset.transfer(creator, amount), "transfer failed");
    }

    function upgradeTo(address next) external {
        implementation = next;
    }

    fallback() external payable {
        address target = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
