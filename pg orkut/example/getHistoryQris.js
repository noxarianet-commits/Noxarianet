const OrderKuota = require('../src/OrderKuota');

const username = '';
const token = '123456:abcdefghi...........';
const orderkuota = new OrderKuota(username, token);

(async () => {
    try {
        // Get All Transaction
        const transactions = await orderkuota.getTransactionQris();
        console.log("Transaction QRIS:", JSON.stringify(transactions, null, 2));

        // Withdraw QRIS (Contoh):
        // const withdraw = await orderkuota.withdrawalQris(10000);
        // console.log("Withdrawal Result:", withdraw);
    } catch (error) {
        console.error("Error:", error);
    }
})();
