const StellarSdk = require('@stellar/stellar-sdk');
const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");

async function checkBalance(publicKey) {
   try {
       const account = await server.loadAccount(publicKey);
       console.log("Balances for:", publicKey);
       account.balances.forEach(balance => {
           console.log("Type:", balance.asset_type, "Balance:", balance.balance);
       });
   } catch (error) {
       console.error("Error:", error);
   }
}

checkBalance('GDNXPT2E3SSHASMLTPTDQLGEMESCPCYLKM2Q2CK77VP3QWRBG4GH6C42');