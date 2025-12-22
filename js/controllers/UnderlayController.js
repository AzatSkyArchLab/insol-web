/**
 * ============================================
 * UnderlayController.js
 * Контроллер DXF-подложек
 * ============================================
 */

import { UnderlayManager } from '../underlay/UnderlayManager.js';
import { UnderlayPanel } from '../underlay/UnderlayPanel.js';
import { GroupManager } from '../underlay/GroupManager.js';

class UnderlayController {
    /**
     * @param {App} app
     */
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.bus = app.bus;
        
        this.manager = null;
        this.panel = null;
        this.groupManager = null;
        
        this._bindBusEvents();
        this._exposeGlobalMethods();
        
        console.log('[UnderlayController] Создан');
    }
    
    /**
     * Привязка событий шины
     */
    _bindBusEvents() {
        // При загрузке сцены — инициализируем менеджер
        this.bus.on('scene:loaded', () => {
            this._initManager();
        });
        
        // При очистке сцены — очищаем подложки
        this.bus.on('scene:cleared', () => {
            if (this.groupManager) {
                this.groupManager.clear();
            }
            if (this.manager) {
                this.manager.clear();
            }
            if (this.panel) {
                this.panel.hide();
            }
        });
        
        // При смене инструмента
        this.bus.on('tool:changed', ({ tool }) => {
            if (tool === 'underlay') {
                this.enableTool();
            } else {
                this.disableTool();
            }
        });
    }
    
    /**
     * Экспорт методов в window
     */
    _exposeGlobalMethods() {
        window.showUnderlayPanel = () => this.showPanel();
        window.loadDxfFile = () => this.loadFile();
    }
    
    /**
     * Инициализация менеджера (после загрузки сцены)
     */
    _initManager() {
        const { state } = this;
        
        if (!state.sceneManager) {
            console.warn('[UnderlayController] SceneManager не готов');
            return;
        }
        
        // Создаём менеджеры
        this.manager = new UnderlayManager(state.sceneManager);
        state.underlayManager = this.manager;
        
        this.groupManager = new GroupManager();
        state.groupManager = this.groupManager;
        
        // Создаём панель (без отдельного UnderlayTool - теперь используем MoveTool)
        this.panel = new UnderlayPanel(this.manager, {
            onChange: (underlay) => {
                // Обновляем позиции зданий группы при изменении через панель
                if (this.groupManager && underlay) {
                    const group = this.groupManager.getGroupByUnderlay(underlay.id);
                    if (group) {
                        this.groupManager.updateBuildingsPosition(group);
                    }
                }
                this.bus.emit('underlay:changed', { underlay });
            },
            onSelect: (underlay) => {
                this.bus.emit('underlay:selected', { underlay });
            },
            onLoad: (underlay) => {
                this.bus.emit('underlay:loaded', { underlay });
            },
            onGroup: (group) => {
                this.bus.emit('group:created', { group });
            },
            onUngroup: (group) => {
                this.bus.emit('group:dissolved', { group });
            }
        });
        
        // Связываем панель с GroupManager
        this.panel.setGroupManager(this.groupManager);
        
        console.log('[UnderlayController] Инициализирован');
    }
    
    /**
     * Показать панель
     */
    showPanel() {
        if (!this.state.sceneManager) {
            alert('Сначала загрузите область на карте');
            return;
        }
        
        if (!this.panel) {
            this._initManager();
        }
        
        this.panel.show();
    }
    
    /**
     * Загрузить DXF файл (диалог)
     */
    loadFile() {
        if (!this.state.sceneManager) {
            alert('Сначала загрузите область на карте');
            return;
        }
        
        if (!this.manager) {
            this._initManager();
        }
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.dxf';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const underlay = await this.manager.loadFile(file);
                
                if (this.panel) {
                    this.panel.show();
                    this.panel.selectUnderlay(underlay);
                }
                
                this.bus.emit('underlay:loaded', { underlay });
                
            } catch (err) {
                alert(`Ошибка загрузки DXF: ${err.message}`);
            }
        };
        
        input.click();
    }
    
    /**
     * Включить инструмент подложек (для совместимости)
     */
    enableTool() {
        // Теперь подложки управляются через SelectTool и MoveTool
        // Этот метод оставлен для совместимости
    }
    
    /**
     * Отключить инструмент подложек (для совместимости)
     */
    disableTool() {
        // Теперь подложки управляются через SelectTool и MoveTool
    }
    
    /**
     * Сериализация для сохранения проекта
     */
    serialize() {
        const data = {
            underlays: this.manager ? this.manager.serialize() : [],
            groups: this.groupManager ? this.groupManager.serialize() : []
        };
        return data;
    }
    
    /**
     * Восстановление из данных проекта
     */
    deserialize(data) {
        if (!this.manager) {
            this._initManager();
        }
        
        // Восстанавливаем подложки
        if (data.underlays && data.underlays.length > 0) {
            this.manager.deserialize(data.underlays);
        }
        
        // Восстанавливаем группы
        if (data.groups && data.groups.length > 0 && this.groupManager) {
            const buildingsGroup = this.state.sceneManager.getBuildingsGroup();
            this.groupManager.deserialize(data.groups, this.manager, buildingsGroup);
        }
        
        if (this.panel) {
            this.panel.refresh();
        }
    }
}

export { UnderlayController };
