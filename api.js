// BtcTurk API Entegrasyonu
class BtcTurkAPI {
    constructor(apiKey, apiSecret) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.baseUrl = 'https://api.btcturk.com';
        this.graphUrl = 'https://graph-api.btcturk.com';
    }
    
    // HMAC-SHA256 imza oluştur
    createSignature(data) {
        const encoder = new TextEncoder();
        const key = encoder.encode(this.apiSecret);
        const message = encoder.encode(data);
        
        return crypto.subtle.importKey(
            'raw',
            key,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        ).then(key => {
            return crypto.subtle.sign('HMAC', key, message);
        }).then(signature => {
            return btoa(String.fromCharCode(...new Uint8Array(signature)));
        });
    }
    
    // API isteği yap
    async makeRequest(endpoint, method = 'GET', data = null) {
        const timestamp = Date.now().toString();
        const message = this.apiKey + timestamp;
        
        try {
            const signature = await this.createSignature(message);
            
            const headers = {
                'X-PCK': this.apiKey,
                'X-Stamp': timestamp,
                'X-Signature': signature,
                'Content-Type': 'application/json'
            };
            
            const options = {
                method: method,
                headers: headers
            };
            
            if (data && method !== 'GET') {
                options.body = JSON.stringify(data);
            }
            
            const response = await fetch(this.baseUrl + endpoint, options);
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status} - ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API Request Error:', error);
            throw error;
        }
    }
    
    // Bakiye bilgilerini al
    async getBalances() {
        try {
            const response = await this.makeRequest('/api/v1/users/balances');
            return response.data || [];
        } catch (error) {
            console.error('Bakiye alma hatası:', error);
            throw error;
        }
    }
    
    // Ticker bilgilerini al
    async getTickers() {
        try {
            const response = await this.makeRequest('/api/v1/ticker');
            return response.data || [];
        } catch (error) {
            console.error('Ticker alma hatası:', error);
            throw error;
        }
    }
    
    // OHLCV verilerini al
    async getOHLCV(symbol, resolution = '1h', count = 100) {
        try {
            const endpoint = `/api/v1/ohlcs?pair=${symbol}&resolution=${resolution}&count=${count}`;
            const response = await fetch(this.graphUrl + endpoint);
            
            if (!response.ok) {
                throw new Error(`Graph API Error: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('OHLCV alma hatası:', error);
            throw error;
        }
    }
    
    // Sipariş ver
    async placeOrder(symbol, side, quantity, price = null) {
        try {
            const orderData = {
                pair: symbol,
                side: side,
                type: price ? 'limit' : 'market',
                quantity: quantity.toString()
            };
            
            if (price) {
                orderData.price = price.toString();
            }
            
            const response = await this.makeRequest('/api/v1/order', 'POST', orderData);
            return response;
        } catch (error) {
            console.error('Sipariş verme hatası:', error);
            throw error;
        }
    }
    
    // Açık pozisyonları al
    async getOpenOrders() {
        try {
            const response = await this.makeRequest('/api/v1/openOrders');
            return response.data || [];
        } catch (error) {
            console.error('Açık pozisyonlar alma hatası:', error);
            throw error;
        }
    }
}

// Global API instance
let api = null;

// API'yi başlat
function initializeAPI(apiKey, apiSecret) {
    api = new BtcTurkAPI(apiKey, apiSecret);
    return api;
}

// Bakiye verilerini gerçek API'den al
async function loadRealBalances() {
    if (!api) {
        throw new Error('API başlatılmamış');
    }
    
    try {
        const balances = await api.getBalances();
        const tickers = await api.getTickers();
        
        // Ticker verilerini sembol bazında grupla
        const tickerMap = {};
        tickers.forEach(ticker => {
            tickerMap[ticker.pair] = ticker;
        });
        
        // Bakiye verilerini işle
        const processedBalances = {};
        let totalValue = 0;
        
        balances.forEach(balance => {
            if (parseFloat(balance.balance) > 0) {
                const asset = balance.asset;
                const balanceAmount = parseFloat(balance.balance);
                
                let valueInTRY = 0;
                
                if (asset === 'TRY') {
                    valueInTRY = balanceAmount;
                } else {
                    // TRY cinsinden değer hesapla
                    const tryPair = asset + 'TRY';
                    const ticker = tickerMap[tryPair];
                    
                    if (ticker) {
                        valueInTRY = balanceAmount * parseFloat(ticker.last);
                    }
                }
                
                processedBalances[asset] = {
                    balance: balanceAmount,
                    value: valueInTRY
                };
                
                totalValue += valueInTRY;
            }
        });
        
        return {
            balances: processedBalances,
            totalValue: totalValue
        };
        
    } catch (error) {
        console.error('Gerçek bakiye yükleme hatası:', error);
        throw error;
    }
}

// Gerçek trading sinyali üret
async function generateRealSignal(symbol, strategy) {
    if (!api) {
        throw new Error('API başlatılmamış');
    }
    
    try {
        // OHLCV verilerini al
        const ohlcvData = await api.getOHLCV(symbol, '1h', 100);
        
        if (!ohlcvData.data || ohlcvData.data.length < 20) {
            return { action: 'hold', confidence: 0, reason: 'Yetersiz veri' };
        }
        
        const prices = ohlcvData.data.map(candle => parseFloat(candle.close));
        const volumes = ohlcvData.data.map(candle => parseFloat(candle.volume));
        
        // Basit teknik analiz
        const currentPrice = prices[prices.length - 1];
        const sma20 = calculateSMA(prices, 20);
        const sma50 = calculateSMA(prices, 50);
        const rsi = calculateRSI(prices, 14);
        
        let signal = { action: 'hold', confidence: 0, reason: 'Sinyal yok' };
        
        // Strateji bazında sinyal üret
        if (strategy === 'turtle') {
            signal = generateTurtleSignal(prices, currentPrice);
        } else if (strategy === 'scalping') {
            signal = generateScalpingSignal(prices, rsi, volumes);
        } else {
            signal = generateORBSignal(prices, volumes);
        }
        
        return signal;
        
    } catch (error) {
        console.error('Sinyal üretme hatası:', error);
        return { action: 'hold', confidence: 0, reason: 'Hata: ' + error.message };
    }
}

// Basit Hareketli Ortalama hesapla
function calculateSMA(prices, period) {
    if (prices.length < period) return 0;
    
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

// RSI hesapla
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// Turtle Trading sinyali
function generateTurtleSignal(prices, currentPrice) {
    const high20 = Math.max(...prices.slice(-20));
    const low20 = Math.min(...prices.slice(-20));
    const high55 = Math.max(...prices.slice(-55));
    const low55 = Math.min(...prices.slice(-55));
    
    if (currentPrice > high20) {
        return { action: 'buy', confidence: 0.7, reason: 'Turtle Breakout (20 günlük yüksek)' };
    } else if (currentPrice < low20) {
        return { action: 'sell', confidence: 0.7, reason: 'Turtle Breakdown (20 günlük düşük)' };
    } else if (currentPrice > high55) {
        return { action: 'buy', confidence: 0.8, reason: 'Turtle Major Breakout (55 günlük yüksek)' };
    } else if (currentPrice < low55) {
        return { action: 'sell', confidence: 0.8, reason: 'Turtle Major Breakdown (55 günlük düşük)' };
    }
    
    return { action: 'hold', confidence: 0, reason: 'Turtle sinyali yok' };
}

// Scalping sinyali - Optimize edilmiş
function generateScalpingSignal(prices, rsi, volumes) {
    const currentPrice = prices[prices.length - 1];
    const sma5 = calculateSMA(prices, 5);
    const sma10 = calculateSMA(prices, 10);
    const sma20 = calculateSMA(prices, 20);
    const avgVolume = calculateSMA(volumes, 10);
    const currentVolume = volumes[volumes.length - 1];
    
    // Daha katı kriterler - sadece güçlü sinyaller
    if (rsi < 25 && currentPrice > sma20 && currentVolume > avgVolume * 2.0) {
        return { action: 'buy', confidence: 0.8, reason: 'Çok oversold + Güçlü volume' };
    } else if (rsi > 75 && currentPrice < sma20 && currentVolume > avgVolume * 2.0) {
        return { action: 'sell', confidence: 0.8, reason: 'Çok overbought + Güçlü volume' };
    } else if (sma5 > sma20 && rsi > 55 && currentVolume > avgVolume * 1.8) {
        return { action: 'buy', confidence: 0.75, reason: 'Güçlü yükseliş trendi' };
    } else if (sma5 < sma20 && rsi < 45 && currentVolume > avgVolume * 1.8) {
        return { action: 'sell', confidence: 0.75, reason: 'Güçlü düşüş trendi' };
    }
    
    return { action: 'hold', confidence: 0, reason: 'Scalping sinyali yok' };
}

// ORB sinyali
function generateORBSignal(prices, volumes) {
    const currentPrice = prices[prices.length - 1];
    const openPrice = prices[prices.length - 1]; // Günlük açılış fiyatı
    const highPrice = Math.max(...prices.slice(-24)); // Son 24 saat yüksek
    const lowPrice = Math.min(...prices.slice(-24)); // Son 24 saat düşük
    
    const range = highPrice - lowPrice;
    const breakoutThreshold = range * 0.1; // %10 breakout threshold
    
    if (currentPrice > highPrice + breakoutThreshold) {
        return { action: 'buy', confidence: 0.7, reason: 'ORB Breakout (Yukarı)' };
    } else if (currentPrice < lowPrice - breakoutThreshold) {
        return { action: 'sell', confidence: 0.7, reason: 'ORB Breakdown (Aşağı)' };
    }
    
    return { action: 'hold', confidence: 0, reason: 'ORB sinyali yok' };
}
