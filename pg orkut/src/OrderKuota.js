/**
 * [OrderKuota] OrderKuota Api Node.js Class (Un-Official)
 * Author : YuF1Dev (Converted to Node.js)
 * Created at 10-10-2023
 * Updated at 2026
 */
class OrderKuota {
    static API_URL = 'https://app.orderkuota.com:443/api/v2';
    static API_URL_EWALLET = 'https://checker.orderkuota.com:443/api/checkname/produk/095f701f85/11/1263871';
    static API_URL_ORDER = 'https://app.orderkuota.com:443/api/v2/order';
    static HOST = 'app.orderkuota.com';
    static USER_AGENT = 'okhttp/4.12.0';
    static APP_VERSION_NAME = '25.08.11';
    static APP_VERSION_CODE = '250811';
    static APP_REG_ID = 'di309HvATsaiCppl5eDpoc:APA91bFUcTOH8h2XHdPRz2qQ5Bezn-3_TaycFcJ5pNLGWpmaxheQP9Ri0E56wLHz0_b1vcss55jbRQXZgc9loSfBdNa5nZJZVMlk7GS1JDMGyFUVvpcwXbMDg8tjKGZAurCGR4kDMDRJ';
    static PHONE_MODEL = 'SM-G960N';
    static PHONE_UUID = 'di309HvATsaiCppl5eDpoc';

    constructor(username = false, authToken = false) {
        if (username) {
            this.username = username;
        }
        if (authToken) {
            this.authToken = authToken;
        }
    }

    buildHeaders() {
        return {
            'Host': OrderKuota.HOST,
            'User-Agent': OrderKuota.USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded'
        };
    }

    async request(type = "GET", url, post = false, headers = false) {
        const options = {
            method: type,
            headers: headers ? this.buildHeaders() : {}
        };

        if (post) {
            options.body = post;
        }

        try {
            const response = await fetch(url, options);
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                return text;
            }
        } catch (error) {
            throw error;
        }
    }

    async loginRequest(username, password) {
        const payload = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&app_reg_id=${OrderKuota.APP_REG_ID}&app_version_code=${OrderKuota.APP_VERSION_CODE}&app_version_name=${OrderKuota.APP_VERSION_NAME}`;
        return await this.request("POST", `${OrderKuota.API_URL}/login`, payload, true);
    }

    async getAuthToken(username, otp) {
        const payload = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(otp)}&app_reg_id=${OrderKuota.APP_REG_ID}&app_version_code=${OrderKuota.APP_VERSION_CODE}&app_version_name=${OrderKuota.APP_VERSION_NAME}`;
        return await this.request("POST", `${OrderKuota.API_URL}/login`, payload, true);
    }

    async getTransactionQris(type = '') {
        const requestTime = Math.floor(Date.now() / 1000);
        const payload = `request_time=${requestTime}&app_reg_id=${OrderKuota.APP_REG_ID}&phone_android_version=9&app_version_code=${OrderKuota.APP_VERSION_CODE}&phone_uuid=${OrderKuota.PHONE_UUID}&auth_username=${encodeURIComponent(this.username || '')}&requests[1]=point&auth_token=${encodeURIComponent(this.authToken || '')}&app_version_name=${OrderKuota.APP_VERSION_NAME}&ui_mode=light&requests[0]=account&phone_model=${OrderKuota.PHONE_MODEL}`;
        return await this.request("POST", `${OrderKuota.API_URL}/get`, payload, true);
    }

    async withdrawalQris(amount = '') {
        const requestTime = Math.floor(Date.now() / 1000);
        const payload = `request_time=${requestTime}&app_reg_id=${OrderKuota.APP_REG_ID}&phone_android_version=9&app_version_code=${OrderKuota.APP_VERSION_CODE}&phone_uuid=${OrderKuota.PHONE_UUID}&auth_username=${encodeURIComponent(this.username || '')}&requests[qris_withdraw][amount]=${encodeURIComponent(amount)}&auth_token=${encodeURIComponent(this.authToken || '')}&app_version_name=${OrderKuota.APP_VERSION_NAME}&ui_mode=light&requests[0]=account&phone_model=${OrderKuota.PHONE_MODEL}`;
        return await this.request("POST", `${OrderKuota.API_URL}/get`, payload, true);
    }
}

module.exports = OrderKuota;
