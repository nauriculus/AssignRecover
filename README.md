# SOLRecover

**Description:**
This script facilitates the recovery of funds on Solana in cases where users' wallets have been compromised by malicious drainers who exploit vulnerabilities in the Assign Instruction of the Native System Program (11111111111111111111111111111111). The code provided allows affected users to withdraw their funds, including SPL-tokens (such as USDC, JUP, etc.) with a token standard below < 2, as well as pNFTs. Additionally, it includes a function to clear all token accounts associated with the drained wallet and redirect the rent to a designated wallet, instead of the burning wallet, since any SOL remaining after the Assign Instruction is locked.

**Usage:**
This script should be executed with caution and only in situations where wallet compromise has been confirmed. 

If you need any assistance, please don't hesitate to contact me. Before using this code, exercise caution and ensure to replace all keypairs and constants.

This is the way the attacker can potentially transfer the ownership:

```javascript
const transaction = new Transaction().add(
    SystemProgram.assign({
        accountPubkey: new PublicKey("WALLETPUBLICKEY"),
        programId: new PublicKey("NEWOWNERPUBLICKEY"),
    })
);

transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet],
);
console.log('Transaction success: ', signature);
```
