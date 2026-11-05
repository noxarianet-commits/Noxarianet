const OrderKuota = require('./src/OrderKuota');

const username = '';
const token = '123456:abcdefghi...........';
const orderkuota = new OrderKuota(username, token);

(async () => {
    try {
        // Get All History Transaction QRIS
        const result = await orderkuota.getTransactionQris();
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error);
    }
})();
