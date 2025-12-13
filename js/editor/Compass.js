/**
 * ============================================
 * Compass.js
 * Компас - индикатор сторон света (встроен в toolbar)
 * ============================================
 */

class Compass {
    constructor() {
        this.element = null;
        this.ring = null;
        this.rotation = 0;
        
        // Добавляем стили
        this._addStyles();
        
        console.log('[Compass] Создан');
    }
    
    /**
     * Инициализация после создания toolbar
     */
    init() {
        this.element = document.getElementById('compass-mini');
        if (this.element) {
            this.ring = this.element.querySelector('.compass-mini-ring');
            console.log('[Compass] Инициализирован');
        } else {
            console.warn('[Compass] Элемент compass-mini не найден');
        }
    }
    
    _addStyles() {
        if (document.getElementById('compass-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'compass-styles';
        style.textContent = `
            .compass-mini {
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .compass-mini-ring {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: linear-gradient(to bottom, 
                    rgba(200, 0, 0, 0.15) 0%, 
                    rgba(200, 0, 0, 0.15) 50%, 
                    rgba(100, 100, 100, 0.1) 50%, 
                    rgba(100, 100, 100, 0.1) 100%);
                border: 2px solid var(--border);
                position: relative;
                transition: transform 0.15s ease-out;
            }
            
            .compass-mini-n {
                position: absolute;
                top: 2px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 10px;
                font-weight: bold;
                color: #c00;
                line-height: 1;
            }
            
            .compass-mini-ring::before {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 0;
                height: 0;
                transform: translate(-50%, -50%);
            }
            
            .compass-mini-ring::after {
                content: '';
                position: absolute;
                bottom: 3px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 8px;
                color: var(--text-secondary);
            }
        `;
        document.head.appendChild(style);
    }
    
    /**
     * Обновить компас по повороту камеры
     * @param {number} azimuth - Азимут камеры в радианах
     */
    update(azimuth) {
        this.rotation = azimuth;
        if (this.ring) {
            this.ring.style.transform = `rotate(${azimuth}rad)`;
        }
    }
    
    /**
     * Обновить по OrbitControls
     * @param {THREE.OrbitControls} controls
     */
    updateFromControls(controls) {
        const azimuth = controls.getAzimuthalAngle();
        this.update(azimuth);
    }
}

export { Compass };
window.Compass = Compass;