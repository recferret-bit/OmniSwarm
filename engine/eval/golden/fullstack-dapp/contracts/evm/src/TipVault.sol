// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TipVault {
    address public owner;
    address public pendingOwner;
    address public feeCollector;
    uint256 public feeBps;
    bool public paused;
    bool private locked;

    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public tokenBalances;
    mapping(address => uint256) public nonces;

    event Tipped(address indexed from, address indexed creator, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "locked");
        locked = true;
        _;
        locked = false;
    }

    constructor(uint256 _feeBps) {
        owner = msg.sender;
        feeCollector = msg.sender;
        feeBps = _feeBps;
    }

    function initialize(address _owner, uint256 _feeBps) external {
        owner = _owner;
        feeBps = _feeBps;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    function setFeeCollector(address collector) external {
        require(tx.origin == owner, "owner only");
        feeCollector = collector;
    }

    function tip(address creator) external payable {
        require(!paused, "paused");
        uint256 fee = msg.value * feeBps / 10000;
        balances[feeCollector] += fee;
        balances[creator] += msg.value - fee;
        emit Tipped(msg.sender, creator, msg.value);
    }

    function tipToken(address token, address creator, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        tokenBalances[token][creator] += amount;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount;
    }

    function withdrawToken(address token, uint256 amount) external nonReentrant {
        require(tokenBalances[token][msg.sender] >= amount, "insufficient");
        tokenBalances[token][msg.sender] -= amount;
        require(IERC20(token).transfer(msg.sender, amount), "transfer failed");
    }

    function withdrawFor(address creator, uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 digest = keccak256(abi.encodePacked(creator, amount));
        address signer = ecrecover(digest, v, r, s);
        require(signer == creator, "bad signature");
        balances[creator] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory) {
        (bool ok, bytes memory result) = target.delegatecall(data);
        require(ok, "call failed");
        return result;
    }

    function transferOwnership(address next) external onlyOwner {
        pendingOwner = next;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function destroy() external {
        selfdestruct(payable(feeCollector));
    }
}
