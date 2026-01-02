/**
 * WindCFDEPW.js
 * Парсинг и анализ EPW файлов, работа с розой ветров
 */

import { WIND_DIRECTIONS } from './WindCFDConstants.js';

/**
 * Класс для работы с EPW данными
 */
export class EPWParser {
    constructor() {
        this.data = null;
    }
    
    /**
     * Парсинг EPW файла
     * @param {string} content - содержимое файла
     * @param {string} filename - имя файла
     * @returns {Object} - распарсенные данные
     */
    parse(content, filename) {
        const lines = content.split('\n');
        const data = { 
            filename, 
            location: '', 
            speeds: [], 
            directions: [] 
        };
        
        // Парсим заголовок
        if (lines.length > 0) {
            const header = lines[0].split(',');
            if (header.length > 1) data.location = header[1];
        }
        
        // Парсим данные (начиная с 9-й строки)
        for (let i = 8; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(',');
            if (values.length < 22) continue;
            
            const direction = parseFloat(values[20]);
            const speed = parseFloat(values[21]);
            
            if (!isNaN(speed) && !isNaN(direction)) {
                data.directions.push(direction % 360);
                data.speeds.push(speed);
            }
        }
        
        if (data.speeds.length === 0) {
            throw new Error('Не удалось прочитать данные из EPW файла');
        }
        
        // Рассчитываем статистику
        const sortedSpeeds = [...data.speeds].sort((a, b) => a - b);
        data.meanSpeed = sortedSpeeds.reduce((a, b) => a + b, 0) / sortedSpeeds.length;
        data.maxSpeed = sortedSpeeds[sortedSpeeds.length - 1];
        data.p95Speed = sortedSpeeds[Math.floor(sortedSpeeds.length * 0.95)];
        data.p99Speed = sortedSpeeds[Math.floor(sortedSpeeds.length * 0.99)];
        
        // Анализируем по секторам
        data.sectors = this.analyzeSectors(data, 8);
        
        this.data = data;
        return data;
    }
    
    /**
     * Анализ данных по секторам (роза ветров)
     * @param {Object} data - данные EPW
     * @param {number} numSectors - количество секторов
     * @returns {Array} - массив секторов
     */
    analyzeSectors(data, numSectors) {
        const sectorSize = 360 / numSectors;
        const sectors = Array.from({ length: numSectors }, () => ({ 
            directions: [], 
            speeds: [] 
        }));
        
        // Распределяем данные по секторам
        for (let j = 0; j < data.directions.length; j++) {
            const idx = Math.floor((data.directions[j] + sectorSize / 2) / sectorSize) % numSectors;
            sectors[idx].speeds.push(data.speeds[j]);
        }
        
        const { names, angles } = WIND_DIRECTIONS;
        
        return sectors.map((s, i) => {
            const sortedSpeeds = [...s.speeds].sort((a, b) => a - b);
            const p95Index = Math.floor(sortedSpeeds.length * 0.95);
            
            return {
                name: names[i],
                angle: angles[i],
                count: s.speeds.length,
                frequency: (s.speeds.length / data.speeds.length) * 100,
                meanSpeed: s.speeds.length > 0 
                    ? s.speeds.reduce((a, b) => a + b, 0) / s.speeds.length 
                    : 0,
                p95Speed: sortedSpeeds.length > 0 
                    ? sortedSpeeds[p95Index] || sortedSpeeds[sortedSpeeds.length - 1] 
                    : 0,
                maxSpeed: sortedSpeeds.length > 0 
                    ? sortedSpeeds[sortedSpeeds.length - 1] 
                    : 0
            };
        });
    }
    
    /**
     * Загрузка EPW файла через file input
     * @returns {Promise<Object>} - распарсенные данные
     */
    loadFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.epw';
            
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) {
                    reject(new Error('Файл не выбран'));
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = (evt) => {
                    try {
                        const data = this.parse(evt.target.result, file.name);
                        resolve(data);
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = () => reject(new Error('Ошибка чтения файла'));
                reader.readAsText(file);
            };
            
            input.click();
        });
    }
    
    /**
     * Получение скорости для направления по типу
     * @param {number} angle - угол направления
     * @param {string} speedType - тип скорости ('mean', 'p95', 'p99', 'max')
     * @returns {number} - скорость
     */
    getSpeedForDirection(angle, speedType) {
        if (!this.data) return 4.0;
        
        const sector = this.data.sectors?.find(s => s.angle === angle);
        
        switch (speedType) {
            case 'mean':
                return sector ? sector.meanSpeed : this.data.meanSpeed;
            case 'p95':
                return sector?.p95Speed || this.data.p95Speed;
            case 'p99':
                return this.data.p99Speed;
            case 'max':
                return sector?.maxSpeed || this.data.maxSpeed;
            default:
                return sector ? sector.meanSpeed : this.data.meanSpeed;
        }
    }
}

/**
 * Генератор HTML для розы ветров
 * @param {Array} sectors - массив секторов
 * @param {Object} results - объект с результатами расчётов
 * @param {Function} onClick - обработчик клика
 * @returns {HTMLElement} - контейнер с кнопками
 */
export function renderWindRoseButtons(sectors, results, onClick) {
    const container = document.createElement('div');
    container.className = 'wcfd-wind-rose';
    
    sectors.forEach((sector, i) => {
        const btn = document.createElement('button');
        btn.className = 'wcfd-wind-btn';
        btn.dataset.angle = sector.angle;
        
        // Проверяем есть ли результат
        if (results[sector.angle]) {
            btn.classList.add('calculated');
        }
        
        btn.innerHTML = `
            <div class="dir">${sector.name}</div>
            <div class="speed">${sector.meanSpeed.toFixed(1)} м/с</div>
            <div class="speed">${sector.frequency.toFixed(0)}%</div>
        `;
        
        btn.onclick = () => onClick(i, btn);
        container.appendChild(btn);
    });
    
    return container;
}

/**
 * Генератор HTML для информации о EPW
 * @param {Object} epwData - данные EPW
 * @returns {string} - HTML строка
 */
export function renderEPWInfo(epwData) {
    if (!epwData) {
        return 'Файл не загружен';
    }
    
    return `
        <strong>${epwData.location || epwData.filename}</strong><br>
        ${epwData.speeds.length} записей<br>
        <div style="margin-top: 8px;">
            <label>Скорость ветра:</label>
            <select id="wcfd-speed-preset" style="width: 100%; margin-top: 4px; padding: 4px;">
                <option value="mean">Средняя (по секторам)</option>
                <option value="p95">Порывы 95% (по секторам)</option>
                <option value="p99">Экстремум 99% (глобальный): ${epwData.p99Speed.toFixed(1)} м/с</option>
                <option value="max">Максимум (по секторам)</option>
                <option value="custom">Вручную...</option>
            </select>
            <input type="number" id="wcfd-speed-custom" style="width: 100%; margin-top: 4px; padding: 4px; display: none;" 
                   placeholder="Скорость м/с" min="0.1" max="50" step="0.1">
        </div>
    `;
}