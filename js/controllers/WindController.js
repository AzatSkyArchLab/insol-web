/**
 * ============================================
 * WindController.js
 * Управление ветровым анализом
 * ============================================
 */

class WindController {
    /**
     * @param {App} app - главный класс приложения
     */
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.bus = app.bus;
        
        this._bindBusEvents();
        this._exposeGlobalMethods();
        
        console.log('[WindController] Создан');
    }
    
    /**
     * Привязка событий шины
     */
    _bindBusEvents() {
        this.bus.on('scene:cleared', () => {
            this.removeOverlay();
            this._hideLegend();
        });
    }
    
    /**
     * Экспорт методов в window (для меню)
     */
    _exposeGlobalMethods() {
        window.showWindAnalysis = () => this.showAnalysis();
        window.showCFDPanel = () => this.showCFDPanel();
        window.loadWindResults = () => this.loadResults();
        window.removeWindOverlay = () => this.removeOverlay();
    }
    
    /**
     * Показать анализ ветра (загрузка JSON)
     */
    showAnalysis() {
        const { state } = this;
        
        if (!state.sceneManager) {
            alert('Сначала загрузите область на карте');
            return;
        }
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    
                    if (!data.grid || !data.grid.values) {
                        alert('Неверный формат. Нужен JSON от CFD анализа.');
                        return;
                    }
                    
                    this.renderOverlay(data);
                    console.log('[Wind] Загружено:', data.grid.nx, 'x', data.grid.ny);
                    
                } catch (err) {
                    alert('Ошибка: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        
        input.click();
    }
    
    /**
     * Показать панель CFD
     */
    showCFDPanel() {
        const { state } = this;
        
        if (!state.sceneManager) {
            alert('Сначала загрузите область на карте');
            return;
        }
        
        // Ленивая инициализация WindCFD
        if (!state.windCFD) {
            // Динамический импорт
            import('../analysis/WindCFD.js').then(({ WindCFD }) => {
                state.windCFD = new WindCFD(state.sceneManager, state.coords);
                state.windCFD.show();
            });
        } else {
            state.windCFD.show();
        }
    }
    
    /**
     * Загрузить результаты CFD
     */
    loadResults() {
        const { state } = this;
        
        if (!state.sceneManager) {
            alert('Сначала загрузите область на карте');
            return;
        }
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    
                    // Ленивая инициализация
                    if (!state.windCFD) {
                        import('../analysis/WindCFD.js').then(({ WindCFD }) => {
                            state.windCFD = new WindCFD(state.sceneManager, state.coords);
                            state.windCFD.loadResults(data);
                            state.windCFD.show();
                        });
                    } else {
                        state.windCFD.loadResults(data);
                        state.windCFD.show();
                    }
                    
                    console.log('[Wind] Результаты загружены');
                } catch (err) {
                    alert('Ошибка чтения файла: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        
        input.click();
    }
    
    /**
     * Отрисовка ветрового overlay
     */
    renderOverlay(data) {
        const { state } = this;
        
        this.removeOverlay();
        
        const grid = data.grid;
        const nx = grid.nx;
        const ny = grid.ny;
        const spacing = grid.spacing;
        const origin = grid.origin;
        
        // Создаём canvas
        const canvas = document.createElement('canvas');
        canvas.width = nx;
        canvas.height = ny;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(nx, ny);
        
        // Заполняем пиксели
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                const amp = grid.values[iy][ix];
                const color = this._ampToColor(amp);
                const idx = ((ny - 1 - iy) * nx + ix) * 4;
                imageData.data[idx] = color.r;
                imageData.data[idx + 1] = color.g;
                imageData.data[idx + 2] = color.b;
                imageData.data[idx + 3] = amp < 0.01 ? 0 : 180;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        
        // Создаём текстуру
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        
        const width = nx * spacing;
        const height = ny * spacing;
        
        // Создаём меш
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        state.windOverlay = new THREE.Mesh(geometry, material);
        state.windOverlay.position.set(
            origin[0] + width / 2,
            origin[1] + height / 2,
            2
        );
        
        state.sceneManager.scene.add(state.windOverlay);
        state.windOverlayVisible = true;
        
        console.log('[Wind] Overlay:', width.toFixed(0), 'x', height.toFixed(0), 'м');
        this._showLegend();
    }
    
    /**
     * Удалить overlay
     */
    removeOverlay() {
        const { state } = this;
        
        if (state.windOverlay) {
            state.sceneManager.scene.remove(state.windOverlay);
            if (state.windOverlay.material.map) {
                state.windOverlay.material.map.dispose();
            }
            state.windOverlay.material.dispose();
            state.windOverlay.geometry.dispose();
            state.windOverlay = null;
            state.windOverlayVisible = false;
        }
        
        this._hideLegend();
    }
    
    // ============================================
    // Private helpers
    // ============================================
    
    /**
     * Преобразование амплитуды в цвет
     */
    _ampToColor(amp) {
        if (amp < 0.01) return { r: 51, g: 51, b: 51 };
        if (amp < 0.5) return { r: 50, g: 136, b: 189 };
        if (amp < 0.8) return { r: 153, g: 213, b: 148 };
        if (amp < 1.0) return { r: 254, g: 224, b: 139 };
        if (amp < 1.2) return { r: 252, g: 141, b: 89 };
        return { r: 213, g: 62, b: 79 };
    }
    
    /**
     * Показать легенду
     */
    _showLegend() {
        this._hideLegend();
        
        const legend = document.createElement('div');
        legend.id = 'wind-legend';
        legend.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0,0,0,0.8);
            padding: 15px;
            border-radius: 8px;
            color: white;
            font-size: 12px;
            z-index: 1000;
        `;
        legend.innerHTML = `
            <div style="font-weight:bold;margin-bottom:10px;">Ветер (amp)</div>
            <div style="display:flex;align-items:center;margin:4px 0;">
                <span style="width:20px;height:20px;background:#d53e4f;margin-right:8px;"></span> >1.2 опасно
            </div>
            <div style="display:flex;align-items:center;margin:4px 0;">
                <span style="width:20px;height:20px;background:#fc8d59;margin-right:8px;"></span> 1.0-1.2 ветрено
            </div>
            <div style="display:flex;align-items:center;margin:4px 0;">
                <span style="width:20px;height:20px;background:#fee08b;margin-right:8px;"></span> 0.8-1.0 умеренно
            </div>
            <div style="display:flex;align-items:center;margin:4px 0;">
                <span style="width:20px;height:20px;background:#99d594;margin-right:8px;"></span> 0.5-0.8 комфортно
            </div>
            <div style="display:flex;align-items:center;margin:4px 0;">
                <span style="width:20px;height:20px;background:#3288bd;margin-right:8px;"></span> <0.5 тихо
            </div>
            <button id="wind-hide-btn" style="margin-top:10px;padding:5px 10px;cursor:pointer;width:100%;">
                Скрыть ветер
            </button>
        `;
        document.body.appendChild(legend);
        
        document.getElementById('wind-hide-btn').onclick = () => {
            this.removeOverlay();
        };
    }
    
    /**
     * Скрыть легенду
     */
    _hideLegend() {
        const legend = document.getElementById('wind-legend');
        if (legend) legend.remove();
    }
}

export { WindController };
