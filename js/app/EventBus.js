/**
 * ============================================
 * EventBus.js
 * Простой pub/sub для коммуникации между модулями
 * ============================================
 * 
 * События:
 * 
 * Сцена:
 *   'scene:loaded'        — сцена загружена { bounds, buildingCount }
 *   'scene:cleared'       — сцена очищена
 * 
 * Здания:
 *   'building:selected'   — выбрано здание { mesh, data }
 *   'building:deselected' — снято выделение
 *   'building:multiselect'— множественный выбор { meshes }
 *   'building:changed'    — изменено здание { mesh, changeType }
 *   'building:deleted'    — удалено здание { meshId }
 *   'building:created'    — создано здание { mesh }
 * 
 * Инструменты:
 *   'tool:changed'        — сменился инструмент { tool, prevTool }
 * 
 * Инсоляция:
 *   'insolation:calculated' — расчёт завершён { results, stats }
 *   'insolation:cleared'    — сетка очищена
 * 
 * Проект:
 *   'project:imported'    — проект импортирован
 *   'project:exported'    — проект экспортирован
 */

class EventBus {
    constructor() {
        this.listeners = new Map();
        this.onceListeners = new Map();
        
        // Для отладки
        this.debug = false;
    }
    
    /**
     * Подписаться на событие
     * @param {string} event - имя события
     * @param {Function} callback - обработчик
     * @returns {Function} - функция отписки
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        
        // Возвращаем функцию отписки
        return () => this.off(event, callback);
    }
    
    /**
     * Подписаться на событие один раз
     * @param {string} event - имя события
     * @param {Function} callback - обработчик
     */
    once(event, callback) {
        if (!this.onceListeners.has(event)) {
            this.onceListeners.set(event, []);
        }
        this.onceListeners.get(event).push(callback);
    }
    
    /**
     * Отписаться от события
     * @param {string} event - имя события
     * @param {Function} callback - обработчик
     */
    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }
    
    /**
     * Отправить событие
     * @param {string} event - имя события
     * @param {*} data - данные события
     */
    emit(event, data = null) {
        if (this.debug) {
            console.log(`[EventBus] ${event}`, data);
        }
        
        // Обычные подписчики
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (err) {
                console.error(`[EventBus] Error in handler for "${event}":`, err);
            }
        });
        
        // Одноразовые подписчики
        const onceCallbacks = this.onceListeners.get(event) || [];
        onceCallbacks.forEach(cb => {
            try {
                cb(data);
            } catch (err) {
                console.error(`[EventBus] Error in once handler for "${event}":`, err);
            }
        });
        this.onceListeners.delete(event);
    }
    
    /**
     * Удалить все подписки на событие
     * @param {string} event - имя события
     */
    clear(event) {
        this.listeners.delete(event);
        this.onceListeners.delete(event);
    }
    
    /**
     * Удалить все подписки
     */
    clearAll() {
        this.listeners.clear();
        this.onceListeners.clear();
    }
    
    /**
     * Включить/выключить отладку
     * @param {boolean} enabled
     */
    setDebug(enabled) {
        this.debug = enabled;
    }
}

export { EventBus };
