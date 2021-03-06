var eventHandlers = {
    interpretKeyEvents: function(event) {
        var mapping = event.shiftKey ? Flame.MODIFIED_KEY_BINDINGS : Flame.KEY_BINDINGS;
        var eventName = mapping[event.keyCode];
        if (eventName && this[eventName]) {
            var handler = this[eventName];
            if (handler && Ember.typeOf(handler) === "function") {
                return handler.call(this, event, this);
            }
        }
        return false;
    },

    handleKeyEvent: function(event, view) {
        var emberEvent = null;
        switch (event.type) {
            case "keydown": emberEvent = 'keyDown'; break;
            case "keypress": emberEvent = 'keyPress'; break;
        }
        var handler = emberEvent ? this.get(emberEvent) : null;
        if (window.FlameInspector && emberEvent) FlameInspector.logEvent(event, emberEvent, this);
        if (handler) {
            // Note that in jQuery, the contract is that event handler should return
            // true to allow default handling, false to prevent it. But in Ember, event handlers return true if they handled the event,
            // false if they didn't, so we want to invert that return value here.
            return !handler.call(Flame.keyResponderStack.current(), event, Flame.keyResponderStack.current());
        } else if (emberEvent === "keyDown" && this.interpretKeyEvents(event)) { // Try to hand down the event to a more specific key event handler
            return false;
        } else if (this.get('parentView')) {
            return this.get('parentView').handleKeyEvent(event, view);
        }
    }
};

Ember.View.reopen(eventHandlers);
// This was preventing bindings from firing on each keystroke. LM/DZ
// Ember.TextSupport.reopen(eventHandlers);

Flame.KEY_BINDINGS = {
    8: 'deleteBackward',
    9: 'insertTab',
    13: 'insertNewline',
    27: 'cancel',
    32: 'insertSpace',
    37: 'moveLeft',
    38: 'moveUp',
    39: 'moveRight',
    40: 'moveDown',
    46: 'deleteForward'
};

Flame.MODIFIED_KEY_BINDINGS = {
    8: 'deleteForward',
    9: 'insertBacktab',
    37: 'moveLeftAndModifySelection',
    38: 'moveUpAndModifySelection',
    39: 'moveRightAndModifySelection',
    40: 'moveDownAndModifySelection'
};

// See Flame.TextFieldView for details on what this is needed for
Flame.ALLOW_BROWSER_DEFAULT_HANDLING = {};  // Just a marker value

Ember.mixin(Flame, {
    mouseResponderView: undefined, // Which view handled the last mouseDown/touchStart event?

    /*
      Holds a stack of key responder views. With this we can neatly handle restoring the previous key responder
      when some modal UI element is closed. There's a few simple rules that governs the usage of the stack:
       - mouse click / touch does .replace (this should also be used for programmatically taking focus when not a modal element)
       - opening a modal UI element does .push
       - closing a modal element does .pop

      Also noteworthy is that a view will be signaled that it loses the key focus only when it's popped off the
      stack, not when something is pushed on top. The idea is that when a modal UI element is opened, we know
      that the previously focused view will re-gain the focus as soon as the modal element is closed. So if the
      previously focused view was e.g. in the middle of some edit operation, it shouldn't cancel that operation.
    */
    keyResponderStack: Ember.Object.createWithMixins({
        _stack: [],

        // Observer-friendly version of getting current
        currentKeyResponder: function() {
            return this.current();
        }.property(),

        current: function() {
            var length = this._stack.get('length');
            if (length > 0) return this._stack.objectAt(length - 1);
            else return undefined;
        },

        push: function(view) {
            if (!Ember.none(view)) {
                if (view.willBecomeKeyResponder) view.willBecomeKeyResponder();
                //console.log('View %s became key responder', Ember.guidFor(view));
                if (view.set && !view.isDestroyed) view.set('isFocused', true);
                this._stack.push(view);
                if (view.didBecomeKeyResponder) view.didBecomeKeyResponder();
                this.propertyDidChange('currentKeyResponder');
            }
            return view;
        },

        pop: function() {
            if (this._stack.get('length') > 0) {
                var current = this.current();
                if (current && current.willLoseKeyResponder) current.willLoseKeyResponder();  // Call before popping, could make a difference
                var view = this._stack.pop();
                //console.log('View %s will lose key responder', Ember.guidFor(view));
                if (view.set && !view.isDestroyed) view.set('isFocused', false);
                if (view.didLoseKeyResponder) view.didLoseKeyResponder();
                this.propertyDidChange('currentKeyResponder');
                return view;
            }
            else return undefined;
        },

        replace: function(view) {
            if (this.current() !== view) {
                this.pop();
                return this.push(view);
            }
        }
    })
});

// Set up a handler on the document for key events.
Ember.$(document).on('keydown.sproutcore keypress.sproutcore', null, function(event, triggeringManager) {
    if (Flame.keyResponderStack.current() !== undefined && Flame.keyResponderStack.current().get('isVisible')) {
        return Flame.keyResponderStack.current().handleKeyEvent(event, Flame.keyResponderStack.current());
    }
    return true;
});

var eventManager = {
    keyDown: function(event) {
        if (Flame.keyResponderStack.current() !== undefined && Flame.keyResponderStack.current().get('isVisible')) {
            return Flame.keyResponderStack.current().handleKeyEvent(event, Flame.keyResponderStack.current());
        }
        return true;
    },

    keyPress: function(event) {
        if (Flame.keyResponderStack.current() !== undefined && Flame.keyResponderStack.current().get('isVisible')) {
            return Flame.keyResponderStack.current().handleKeyEvent(event, Flame.keyResponderStack.current());
        }
        return true;
    },

    // For the passed in view, calls the method with the name of the event, if defined. If that method
    // returns true, returns the view. If the method returns false, recurses on the parent view. If no
    // view handles the event, returns false.
    _dispatch: function(eventName, event, view) {
        if (window.FlameInspector) FlameInspector.logEvent(event, eventName, view);
        var handler = view.get(eventName);
        if (handler) {
            var result = handler.call(view, event, view);
            if (result === Flame.ALLOW_BROWSER_DEFAULT_HANDLING) return false;
            else if (result) return view;
        }
        var parentView = view.get('parentView');
        if (parentView) return this._dispatch(eventName, event, parentView);
        else return false;
    }
};

if ('ontouchstart' in window) {
    normalizeTouchEvent = function(event) {
        if (!event.touches) {
            event.touches = event.originalEvent.touches;
        }
        if (!event.pageX) {
            event.pageX = event.originalEvent.pageX;
        }
        if (!event.pageY) {
            event.pageY = event.originalEvent.pageY;
        }
        if (!event.screenX) {
            event.screenX = event.originalEvent.screenX;
        }
        if (!event.screenY) {
            event.screenY = event.originalEvent.screenY;
        }
        if (!event.clientX) {
            event.clientX = event.originalEvent.clientX;
        }
        if (!event.clientY) {
            event.clientY = event.originalEvent.clientY;
        }
        return event;
    };
    eventManager.normalizeTouchEvent = normalizeTouchEvent;

    eventManager.touchStart = function(event, view) {
        Flame.set('mouseResponderView', undefined);
        normalizeTouchEvent(event);
        var handlingView = this._dispatch('touchStart', event, view);
        if (handlingView) {
            Flame.set('mouseResponderView', handlingView);
        }
        Flame.setProperties({
            isTouchStarted: true,
            dragChecked: false,
            touchStartPosition: { pageX: event.touches[0].pageX, pageY: event.touches[0].pageY }
        });
        return !handlingView;
    };
    eventManager.touchEnd = function(event, view) {
        if (Flame.get('mouseResponderView') !== undefined) {
            view = Flame.get('mouseResponderView');
            Flame.set('mouseResponderView', undefined);
        }
        normalizeTouchEvent(event);
        Flame.set('isTouchStarted', false);
        if (Flame.get('isDragging')) {
            Flame.setProperties({
                isTouchStarted: false,
                isDragging: false,
                touchStartPosition: null
            });
            this._dispatch('customDragEnd', event, view);
            return false;
        } else {
            return !this._dispatch('touchEnd', event, view);
        }
    };
    eventManager.touchCancel = function(event, view) {
        if (Flame.get('mouseResponderView') !== undefined) {
            view = Flame.get('mouseResponderView');
            Flame.set('mouseResponderView', undefined);
        }
        normalizeTouchEvent(event);
        Flame.set('isTouchStarted', false);
        if (Flame.get('isDragging')) {
            Flame.setProperties({
                isTouchStarted: false,
                isDragging: false,
                touchStartPosition: null
            });
            this._dispatch('customDragEnd', event, view);
            return false;
        } else {
            return !this._dispatch('touchCancel', event, view);
        }
    };

    eventManager.touchMove = function(event, view) {
        if (Flame.get('mouseResponderView') !== undefined) {
            view = Flame.get('mouseResponderView');
        }
        normalizeTouchEvent(event);
        if (Flame.get('isTouchStarted')) {
            if (!Flame.get('dragChecked')) {
                var touchStartPos = Flame.get('touchStartPosition'),
                    thresholdExceeded = Math.abs(event.touches[0].pageX - touchStartPos.pageX) > 4 || Math.abs(event.touches[0].pageY - touchStartPos.pageY) > 4;
                if (thresholdExceeded) {
                    Flame.set('dragChecked', true);
                    var dragHandlingView = this._dispatch('customDragStart', event, view);
                    if (dragHandlingView) {
                        Flame.set('mouseResponderView', dragHandlingView);
                        Flame.set('isDragging', true);
                    }
                }
            }
            if (Flame.get('isDragging')) {
                this._dispatch('customDragMove', event, view);
                return false;
            } else {
                return !this._dispatch('touchMove', event, view);
            }
        } else {
            return !this._dispatch('touchMove', event, view);
        }
    };
} else {
    eventManager.mouseDown = function(event, view) {
        if (event.button !== 0) {
            return true;
        }
        view.becomeKeyResponder();  // Becoming a key responder is independent of mouseDown handling
        Flame.set('mouseResponderView', undefined);
        var handlingView = this._dispatch('mouseDown', event, view);
        if (handlingView) {
            Flame.set('mouseResponderView', handlingView);
        }
        Flame.setProperties({
            isMouseDown: true,
            dragChecked: false,
            mouseDownPosition: { pageX: event.pageX, pageY: event.pageY }
        });
        return !handlingView;
    };

    eventManager.mouseUp = function(event, view) {
        if (Flame.get('mouseResponderView') !== undefined) {
            view = Flame.get('mouseResponderView');
            Flame.set('mouseResponderView', undefined);
        }
        Flame.set('isMouseDown', false);
        if (Flame.get('isDragging')) {
            Flame.setProperties({
                isMouseDown: false,
                isDragging: false,
                mouseDownPosition: null
            });
            this._dispatch('customDragEnd', event, view);
            return false;
        } else {
            return !this._dispatch('mouseUp', event, view);
        }
    };

    eventManager.mouseMove = function(event, view) {
        if (Flame.get('mouseResponderView') !== undefined) {
            view = Flame.get('mouseResponderView');
        }

        if (Flame.get('isMouseDown')) {
            if (!Flame.get('dragChecked')) {
                var mouseDownPos = Flame.get('mouseDownPosition'),
                    thresholdExceeded = Math.abs(event.pageX - mouseDownPos.pageX) > 4 || Math.abs(event.pageY - mouseDownPos.pageY) > 4;
                if (thresholdExceeded) {
                    Flame.set('dragChecked', true);
                    var dragHandlingView = this._dispatch('customDragStart', event, view);
                    if (dragHandlingView) {
                        Flame.set('mouseResponderView', dragHandlingView);
                        Flame.set('isDragging', true);
                    }
                }
            }
            if (Flame.get('isDragging')) {
                this._dispatch('customDragMove', event, view);
                return false;
            } else {
                return !this._dispatch('mouseMove', event, view);
            }
        } else {
            return !this._dispatch('mouseMove', event, view);
        }
    };
}

// This logic is needed so that the view that handled mouseDown/touchStart will receive mouseMoves and the eventual
// mouseUp/touchEnd, even if the pointer no longer is on top of that view. Without this, you get inconsistencies with
// buttons and all controls that handle mouse click / touch events. The sproutcore event dispatcher always first looks
// up 'eventManager' property on the view that's receiving an event, and lets that handle the event, if defined.
// So this should be mixed in to all the Flame views.
Flame.EventManager = {
    // Set to true in your view if you want to accept key responder status (which is needed for handling key events)
    acceptsKeyResponder: false,

    /*
      Sets this view as the target of key events. Call this if you need to make this happen programmatically.
      This gets also called on mouseDown/touchStart if the view handles that, returns true and doesn't have property
      'acceptsKeyResponder' set to false. If mouseDown/touchStart returned true but 'acceptsKeyResponder' is false,
      this call is propagated to the parent view.

      If called with no parameters or with replace = true, the current key responder is first popped off the stack and this
      view is then pushed. See comments for Flame.keyResponderStack above for more insight.
    */
    becomeKeyResponder: function(replace) {
        if (this.get('acceptsKeyResponder') !== false && !this.get('isDisabled')) {
            if (replace === undefined || replace === true) {
                Flame.keyResponderStack.replace(this);
            } else {
                Flame.keyResponderStack.push(this);
            }
        } else {
            var parent = this.get('parentView');
            if (parent && parent.becomeKeyResponder) return parent.becomeKeyResponder(replace);
        }
    },

    /*
      Resign key responder status by popping the head off the stack. The head might or might not be this view,
      depending on whether user clicked anything since this view became the key responder. The new key responder
      will be the next view in the stack, if any.
    */
    resignKeyResponder: function() {
        Flame.keyResponderStack.pop();
    },

    eventManager: eventManager
};

