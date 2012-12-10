/*jshint loopfunc: true */

Flame.State = Ember.Object.extend({
    gotoFlameState: function(stateName) {
        this.get('owner').gotoFlameState(stateName);
    },

    $: function(args) {
        args = Array.prototype.slice.call(arguments);
        var owner = this.get('owner');
        return owner.$.apply(owner, args);
    }
});

Flame.State.reopenClass({
    gotoHandler: function(stateName, returnValue) {
        return function() {
            this.gotoFlameState(stateName);
            return returnValue === undefined ? true : returnValue;
        };
    }
});

Flame.Statechart = {
    initialFlameState: null,
    currentFlameState: undefined,
    _currentFlameStateName: undefined,

    init: function() {
        this._super();

        // Look for defined states and initialize them
        var key;
        for (key in this) {
            var state = this[key];
            if (Flame.State.detect(state)) {
                this.set(key, state.create({owner: this}));
                this._setupProxyMethods(this[key]);
            }
        }
        Ember.assert("No initial flame state defined for flame statechart!", !Ember.none(this.get('initialFlameState')));
        this.gotoFlameState(this.get('initialFlameState'));
    },

    /**
      Sets up proxy methods so that methods called on the owner of the statechart
      will be invoked on the current state if they are not present on the owner of
      the statechart.
    */
    _setupProxyMethods: function(state) {
        for (var property in state) {
            if (state.constructor.prototype.hasOwnProperty(property) && Ember.typeOf(state[property]) === "function" &&
                !this[property] && property !== "enterState" && property !== "exitState") {
                this[property] = function(methodName) {
                    return function(args) {
                        args = Array.prototype.slice.call(arguments);
                        args.unshift(methodName);
                        return this.invokeFlameStateMethod.apply(this, args);
                    };
                }(property);
            }
        }
    },

    gotoFlameState: function(stateName) {
        Ember.assert("Cannot go to an undefined or null flame state!", !Ember.none(stateName));
        var currentFlameState = this.get('currentFlameState');
        var newState = this.get(stateName);
        //do nothing if we are already in the state to go to
        if (currentFlameState === newState) {
            return;
        }
        if (!Ember.none(newState) && newState instanceof Flame.State) {
            if (!Ember.none(currentFlameState)) {
                if (currentFlameState.exitState) currentFlameState.exitState();
            }
            this._currentFlameStateName = stateName;
            this.set('currentFlameState', newState);
            if (newState.enterState) newState.enterState();
        } else {
            throw new Error("%@ is not a state!".fmt(stateName));
        }
    },

    /**
     * Is this state chart currently in a state with the given name?
     * @param stateName
     * @returns {Boolean} is this statechart currently in a state with the given name?
     */
    isCurrentlyIn: function(stateName) {
        return this._currentFlameStateName === stateName;
    },

    invokeFlameStateMethod: function(methodName, args) {
        args = Array.prototype.slice.call(arguments); args.shift();
        var state = this.get('currentFlameState');
        Ember.assert("Cannot invoke flame state method without having a current flame state!", !Ember.none(state) && state instanceof Flame.State);
        var method = state[methodName];
        if (Ember.typeOf(method) === "function") {
            return method.apply(state, args);
        }
    }
};
