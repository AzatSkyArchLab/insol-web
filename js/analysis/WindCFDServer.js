/**
 * WindCFDServer.js
 * Взаимодействие с CFD сервером: расчёты, polling, кеш
 */

import { sleep } from './WindCFDUtils.js';

/**
 * Класс для работы с CFD сервером
 */
export class CFDServerClient {
    constructor(serverUrl, sessionId) {
        this.serverUrl = serverUrl;
        this.sessionId = sessionId;
        this.isCalculating = false;
        this.pollingStopped = false;
    }
    
    /**
     * Fetch с добавлением session ID
     */
    async _fetch(url, options = {}) {
        const headers = {
            'X-Session-ID': this.sessionId,
            ...(options.headers || {})
        };
        return fetch(url, { ...options, headers });
    }
    
    /**
     * Загрузка списка кешированных направлений
     */
    async loadCachedDirections() {
        try {
            const resp = await this._fetch(`${this.serverUrl}/directions`);
            if (!resp.ok) return {};
            
            const data = await resp.json();
            return data.directions || {};
        } catch (e) {
            console.log('[CFDServer] Сервер недоступен для загрузки кеша');
            return {};
        }
    }
    
    /**
     * Загрузка данных для конкретного направления
     */
    async loadDirectionData(angle) {
        try {
            const resp = await this._fetch(`${this.serverUrl}/result/${angle}`);
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            console.error(`[CFDServer] Ошибка загрузки данных для ${angle}°:`, e);
            return null;
        }
    }
    
    /**
     * Запуск расчёта
     */
    async startCalculation(config) {
        const response = await this._fetch(`${this.serverUrl}/calculate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        if (!response.ok) {
            throw new Error('Сервер вернул ошибку ' + response.status);
        }
        
        return await response.json();
    }
    
    /**
     * Получение статуса расчёта
     */
    async getStatus() {
        const resp = await this._fetch(`${this.serverUrl}/status`);
        return await resp.json();
    }
    
    /**
     * Получение результата
     */
    async getResult() {
        const resp = await this._fetch(`${this.serverUrl}/result`);
        return await resp.json();
    }
    
    /**
     * Остановка расчёта
     */
    async stopCalculation() {
        await this._fetch(`${this.serverUrl}/stop`, { method: 'POST' });
    }
    
    /**
     * Пересчёт среза на другой высоте
     */
    async resampleSlice(z, direction) {
        const response = await this._fetch(`${this.serverUrl}/resample`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ z, direction })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка пересчёта: ${response.status} - ${errorText}`);
        }
        
        return await response.json();
    }
    
    /**
     * Очистка кеша сервера
     */
    async cleanup() {
        const resp = await this._fetch(`${this.serverUrl}/cleanup`, { method: 'POST' });
        return await resp.json();
    }
    
    /**
     * Получение информации для Paraview
     */
    async getParaviewInfo(direction) {
        const resp = await this._fetch(`${this.serverUrl}/paraview/${direction}`);
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || 'Кейс не найден');
        }
        return await resp.json();
    }
    
    /**
     * Скачивание архива для Paraview
     */
    async downloadParaview(direction) {
        const response = await this._fetch(`${this.serverUrl}/download_paraview/${direction}`);
        if (!response.ok) {
            throw new Error('Ошибка скачивания');
        }
        return await response.blob();
    }
    
    /**
     * Polling статуса с callback
     * @param {Function} onProgress - callback для обновления прогресса
     * @param {Function} onComplete - callback при завершении
     * @param {Function} onError - callback при ошибке
     */
    async pollStatus(onProgress, onComplete, onError) {
        this.pollingStopped = false;
        
        const poll = async () => {
            if (this.pollingStopped) return;
            
            try {
                const status = await this.getStatus();
                onProgress(status);
                
                if (status.status === 'queued' || status.status === 'running') {
                    setTimeout(poll, 2000);
                } else if (status.status === 'completed') {
                    const result = await this.getResult();
                    
                    if (result.error) {
                        throw new Error(result.error);
                    }
                    if (!result.grid || !result.grid.values) {
                        throw new Error('Пустой результат от сервера');
                    }
                    
                    this.pollingStopped = true;
                    onComplete(result);
                } else if (status.status === 'error') {
                    this.pollingStopped = true;
                    onError(new Error(status.message));
                }
            } catch (e) {
                console.error('[CFDServer] Poll error:', e);
                setTimeout(poll, 3000);
            }
        };
        
        poll();
    }
    
    /**
     * Остановка polling
     */
    stopPolling() {
        this.pollingStopped = true;
    }
}

/**
 * Создание конфигурации для расчёта
 */
export function createCFDConfig(geojson, domainParams, windDirection, windSpeed, domainSettings, sliceHeight) {
    return {
        buildings: geojson,
        domain: domainParams,
        wind: {
            direction: windDirection,
            speed: windSpeed
        },
        settings: {
            iterations: domainSettings.iterations,
            cellSize: domainSettings.cellSize,
            sampleHeight: sliceHeight,
            inletFactor: domainSettings.inletFactor,
            outletFactor: domainSettings.outletFactor,
            lateralFactor: domainSettings.lateralFactor,
            heightFactor: domainSettings.heightFactor,
            refinementMin: domainSettings.refinementMin,
            refinementMax: domainSettings.refinementMax,
            maxCells: domainSettings.maxCells
        }
    };
}