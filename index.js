import * as fs from 'fs';
import { TOKEN_PROGRAM_ID,createTransferInstruction, thawAccount, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, createCloseAccountInstruction, createThawAccountInstruction  } from '@solana/spl-token';
import { Connection, Keypair, SystemProgram, sendAndConfirmTransaction, Message,Transaction,ComputeBudgetProgram, PublicKey,StakeProgram, LAMPORTS_PER_SOL, Authorized, VersionedTransaction   } from '@solana/web3.js';

import {
  delegateUtilityV1,
  fetchAllMetadataByOwner,
  fetchMetadata,
  findMetadataPda,
  lockV1,
  delegateStakingV1,
  mplTokenMetadata,
  TokenStandard,
  transferV1,
} from "@metaplex-foundation/mpl-token-metadata";

import { Metaplex, keypairIdentity } from "@metaplex-foundation/js";

const NODE = 'https://mainnet.helius-rpc.com/?api-key=4bb3853f-a7a8-4232-bdfc-833db40de593';
const SENDS_IN_ONE_TX = 2;
const CLOSES_IN_ONE_TX = 20;
const DESTINATION = new PublicKey('YOURPUBLICKEY');
const tokenProgram = TOKEN_PROGRAM_ID;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function getTokenAccounts(connection, publicKey, empty = false) {
    let i = 0;
    while (true) {
        try {
            const { value } = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
            const nftAccounts = value.filter(({ account }) => {
                if (account.data.parsed.info.mint === WRAPPED_SOL) {
                    return false;
                }
                const amount = account.data.parsed.info.tokenAmount.uiAmount;
                if (empty) {
                    return amount === 0;
                }
                else {
                    return amount > 0;
                }
            }).map(({ account, pubkey }) => {
                const amounts = account?.data?.parsed?.info?.tokenAmount;
                return {
                    mint: account.data.parsed.info.mint,
                    tokenAcc: pubkey,
                    count: Number(amounts.amount),
                    uiAmount: Number(amounts.uiAmount),
                };
            });
            return nftAccounts;
        }
        catch (err) {
            console.log(err);
            i++;
            if (i > 3) {
                throw err;
            }
            else {
                continue;
            }
        }
    }
}

async function closeAccounts(
  connection,
) {
  console.log(`\nClosing emptied accounts to reclaim sol...\n`);

  const walletKeyPair = Keypair.fromSecretKey(
    new Uint8Array([111,111,111,111]) //Your Keypair
  );

  while (true) {
      const emptyAccounts = await getTokenAccounts(connection, walletKeyPair.publicKey, true);

      if (emptyAccounts.length === 0) {
          console.log(`Finished closing empty accounts.`);
          break;
      }

      console.log(`Found ${emptyAccounts.length} empty accounts...`);

      const txsNeeded = Math.ceil(emptyAccounts.length / CLOSES_IN_ONE_TX);

      for (let i = 0; i < emptyAccounts.length / CLOSES_IN_ONE_TX; i++) {
          const itemsRemaining = Math.min(CLOSES_IN_ONE_TX, emptyAccounts.length - i * CLOSES_IN_ONE_TX);

          const transaction = new Transaction();

          for (let j = 0; j < itemsRemaining; j++) {
              const item = i * CLOSES_IN_ONE_TX + j;

              const acc = emptyAccounts[item];

              transaction.add(createCloseAccountInstruction(
                  acc.tokenAcc,
                  walletKeyPair.publicKey,
                  walletKeyPair.publicKey,
              ));
          }

          console.log(`Sending transaction ${i+1} / ${txsNeeded}...`);

          try {
              const res = await connection.sendTransaction(
                  transaction,
                  [walletKeyPair]
              );
              console.log(res);
          } catch (err) {
              console.log(`Error sending transaction: ${err.toString()}`);
          }
      }

      await sleep(10 * 1000);
  }
}

async function createATAInstruction(mint, walletKeyPair, connection) {
    const ata = await getAssociatedTokenAddress(new PublicKey(mint), DESTINATION);
    const info = await connection.getAccountInfo(ata);
    if (info) {
        return undefined;
    }

    const walletPayer = Keypair.fromSecretKey(
      new Uint8Array([111,111,111,111]) //Your 2nd Keypair to Pay For Gas
    );
  

    return createAssociatedTokenAccountInstruction(
        walletPayer.publicKey,  // Owner of the ATA
        ata,                      // ATA address
        DESTINATION,              // New account's owner
        new PublicKey(mint),      // Token mint
    );
}

async function createTransferTokenInstruction(mint, count, walletKeyPair, tokenAcc) {
    const destinationATA = await getAssociatedTokenAddress(new PublicKey(mint), DESTINATION);

    const tokenAccount = new PublicKey(tokenAcc);
    return createTransferInstruction(tokenAccount, destinationATA, walletKeyPair.publicKey, count, [], tokenProgram);
}

async function transferAndClean(connection, mint, token) {
  const wallet = Keypair.fromSecretKey(
    new Uint8Array([111,111,111,111]) //Your Keypair which holds the token you want to transfer
  );

  const walletPayer = Keypair.fromSecretKey(
    new Uint8Array([111,111,111,111]) //Your 2nd Keypair to Pay For Gas
  );

  const emptyAccounts = await getTokenAccounts(connection, new PublicKey(wallet.publicKey), true);
  console.log("Found: " + emptyAccounts + " empty accounts.");

  const txsNeeded = Math.ceil(emptyAccounts.length / CLOSES_IN_ONE_TX);
  for (let i = 0; i < emptyAccounts.length / CLOSES_IN_ONE_TX; i++) {
    const itemsRemaining = Math.min(CLOSES_IN_ONE_TX, emptyAccounts.length - i * CLOSES_IN_ONE_TX);

    for (let j = 0; j < itemsRemaining; j++) {
        const item = i * CLOSES_IN_ONE_TX + j;

        const transaction = new Transaction();
        const acc = emptyAccounts[item];

        transaction.add(createCloseAccountInstruction(
          acc.tokenAcc,
          DESTINATION, //Sending rent to another account
          wallet.publicKey,
      ));

      transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      transaction.feePayer = walletPayer.publicKey; //Setting the feePayer to our 2nd wallet
      transaction.partialSign(walletPayer);
      transaction.partialSign(wallet);
  
      console.log(`Sending transaction ${i+1} / ${txsNeeded}...`);

      try {
        const finalTx = await connection.sendTransaction(
          transaction,
          [wallet, walletPayer]
      );
      console.log(finalTx);
      await sleep(10 * 1000);
     
      } catch (err) {
          console.log(`Error sending transaction: ${err.toString()}`);
      }
    }
  }

  const recentBlockhash= await connection.getRecentBlockhash();

  //Token Account Creation Using A 2nd Wallet For Funding
  const transferNFT = new Transaction({
    feePayer: walletPayer.publicKey,
      recentBlockhash: recentBlockhash.blockhash,
    
    })
             
    const createATA = await createATAInstruction(token, wallet, connection);
    console.log(createATA);

    if (createATA) {
      console.log(createATA);
      transferNFT.add(createATA);
  }

    transferNFT.partialSign(walletPayer);

    const txTokenAccount = await sendAndConfirmTransaction(
    connection,
    transferNFT,
    [walletPayer],
    { skipPreflight: true }
    );

    console.log(txTokenAccount); 


    //PNFT Transfer
    const metaplex = Metaplex.make(new Connection(NODE))
    .use(keypairIdentity(wallet));

    const nft = await metaplex.nfts().findByMint({mintAddress: new PublicKey(mint)});
  
    const transferTransactionBuilder = await metaplex.nfts().builders().transfer({
    nftOrSft: nft,
    fromOwner: wallet.publicKey,
    tokenStandard: TokenStandard.ProgrammableNonFungible,
    authority: wallet,
    authorizationRules: new PublicKey(
      "eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9"
    ),
    authorizationDetails: {
      rules: nft.programmableConfig.ruleSet
    },
    tokenOwner: wallet.publicKey,
    toOwner: DESTINATION,
    amount: token(1),
    feePayer: walletPayer,
    });

    const transferPNFT = transferTransactionBuilder.toTransaction(recentBlockhash);
    transferPNFT.partialSign(wallet);

    const transaction = new Transaction({
    recentBlockhash: recentBlockhash.blockhash,
    feePayer: walletPayer.publicKey,

    })
    .add(transferPNFT);

    transaction.partialSign(walletPayer);

    const tx = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet, walletPayer],
      { skipPreflight: true }
      
    );

    console.log("Transaction done: " + tx);
    }

async function transferSPL(connection) {
  const walletPayer = Keypair.fromSecretKey(
  
    new Uint8Array([111,111,111])
  );
  
  const wallet = Keypair.fromSecretKey(
    
    new Uint8Array([111,111,111,111]
      )
  );

  while (true) {
      const accounts = await getTokenAccounts(connection, wallet.publicKey);
      if (accounts.length === 0) {
          console.log(`No tokens found.`);
          break;
      }
      console.log(`Found ${accounts.length} accounts...`);
      const txsNeeded = Math.ceil(accounts.length / SENDS_IN_ONE_TX);
      for (let i = 0; i < accounts.length / SENDS_IN_ONE_TX; i++) {
          const itemsRemaining = Math.min(SENDS_IN_ONE_TX, accounts.length - i * SENDS_IN_ONE_TX);

          const recentBlockhash = await connection.getLatestBlockhash();
          const transaction = new Transaction({
          feePayer: walletPayer.publicKey,
          recentBlockhash: recentBlockhash.blockhash,

          })
                
          for (let j = 0; j < itemsRemaining; j++) {
              const item = i * SENDS_IN_ONE_TX + j;
              const acc = accounts[item];
              const createATA = await createATAInstruction(acc.mint, wallet, connection);
              console.log(createATA);

              if (createATA) {
                  transaction.add(createATA);
              }
              const transfer = await createTransferTokenInstruction(acc.mint, acc.count, wallet, acc.tokenAcc);
              transaction.add(transfer);
              }
            console.log("full txs:" + transaction);
            console.log(`Sending transaction ${i + 1} / ${txsNeeded}...`);
            try {
            transaction.partialSign(walletPayer);
            transaction.partialSign(wallet);
            const wireTransactionToSendBack = transaction.serialize();
            const signature = await connection.sendRawTransaction(wireTransactionToSendBack);
            console.log("Transaction sent: " + signature);
          }
          catch (err) {
              console.log(`Error sending transaction: ${err.toString()}`);
          }
      }
      await sleep(10 * 9000);
  }
  
}

async function main() {

  const connection = new Connection(NODE, {
    confirmTransactionInitialTimeout: 60 * 1000,
    commitment: 'confirmed',
  });
  
  //Specify which function you want to run

  //await transferAndClean(connection, "MINT", "TOKENADDRESS")
  //await closeAccounts(connection);
  //await transferSPL(connection);
   
  }
  
  main();