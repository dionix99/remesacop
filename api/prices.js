const API_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
const BCV_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';

const MARKETS = {
    VES: { fiat: 'VES', payType: 'Mercantil' },
    COP: { fiat: 'COP', payType: 'BancolombiaSA' },
    PEN: { fiat: 'PEN', payType: 'Yape' },
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

async function fetchOrders(fiat, payType) {
    // AbortSignal.timeout cancela la petición de verdad (no solo deja de esperarla)
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(fiat, payType)),
        signal: AbortSignal.timeout(10000),
    });
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

// Tasa oficial del BCV (Bs por dólar)
async function fetchBcv() {
    const resp = await fetch(BCV_URL, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const price = parseFloat(json.promedio ?? json.venta ?? json.compra);
    if (!(price > 0)) throw new Error('Respuesta BCV sin tasa');
    return { price, updatedAt: json.fechaActualizacion || null };
}

export default async function handler(req, res) {
    // La app llama a /api/prices desde el mismo dominio, así que no se
    // necesitan cabeceras CORS: otros sitios no pueden usar este proxy.
    res.setHeader('Cache-Control', 'no-store');

    const fetchOne = async (key) => {
        try {
            const orders = await fetchOrders(MARKETS[key].fiat, MARKETS[key].payType);
            const value = bestUnverifiedBuy(orders);
            return { key, value, error: value ? null : 'Sin anuncios de vendedores no verificados' };
        } catch (e) {
            return { key, value: null, error: String((e && e.message) || e) };
        }
    };

    try {
        const bcvPromise = fetchBcv().then(
            value => ({ value, error: null }),
            e => ({ value: null, error: String((e && e.message) || e) })
        );
        // Cada mercado falla por separado: si PEN (Yape) no responde, Colombia sigue funcionando igual.
        const results = await Promise.all([fetchOne('VES'), fetchOne('COP'), fetchOne('PEN')]);
        const bcv = await bcvPromise;

        const ves = results.find(r => r.key === 'VES');
        const cop = results.find(r => r.key === 'COP');
        const pen = results.find(r => r.key === 'PEN');

        res.status(200).json({
            ok: true,
            updatedAt: new Date().toISOString(),
            ves: ves.value,
            cop: cop.value,
            pen: pen.value,
            bcv: bcv.value,
            errors: { ves: ves.error, cop: cop.error, pen: pen.error, bcv: bcv.error },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: String((err && err.message) || err) });
    }
}
