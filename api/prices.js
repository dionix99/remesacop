const API_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

const MARKETS = {
    VES: { fiat: 'VES', payType: 'Mercantil' },
    COP: { fiat: 'COP', payType: 'BancolombiaSA' },
};

function buildPayload(fiat, payType) {
    return {
        asset: 'USDT',
        fiat,
        merchantCheck: false,
        page: 1,
        rows: 20,
        tradeType: 'BUY',
        payTypes: [payType],
        classifies: ['mass', 'profession'],
    };
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
}

async function fetchOrders(fiat, payType) {
    const resp = await withTimeout(
        fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPayload(fiat, payType)),
        }),
        10000
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return json.data || [];
}

function bestUnverifiedBuy(orders) {
    const unverified = orders.filter(o => o.advertiser && o.advertiser.userType === 'user');
    if (unverified.length === 0) return null;
    unverified.sort((a, b) => parseFloat(a.adv.price) - parseFloat(b.adv.price));
    return {
        price: parseFloat(unverified[0].adv.price),
        nick: unverified[0].advertiser.nickName,
    };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const fetchOne = async (key) => {
        try {
            const orders = await fetchOrders(MARKETS[key].fiat, MARKETS[key].payType);
            return { key, value: bestUnverifiedBuy(orders), error: null };
        } catch (e) {
            return { key, value: null, error: String((e && e.message) || e) };
        }
    };

    try {
        const results = await Promise.all([fetchOne('VES'), fetchOne('COP')]);

        const ves = results.find(r => r.key === 'VES').value;
        const cop = results.find(r => r.key === 'COP').value;

        res.status(200).json({
            ok: true,
            updatedAt: new Date().toISOString(),
            ves,
            cop,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: String((err && err.message) || err) });
    }
}
