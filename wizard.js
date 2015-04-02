var wizardsById = {};
var defaultId = '_defaultId';

function stepParams(id) {
  return Tracker.nonreactive(function() {
    var route = Router.current()
      , params = route.params || {};
      
    return _.extend(params, {step: id});
  });
}

Template.registerHelper('pathForStep', function(id) {
  var activeStep = this.wizard.activeStep(false);
  if (activeStep.id === id || !this.data() || this.wizard.indexOf(id) > this.wizard.indexOf(activeStep.id)) {
    return null;
  } else if (!Router || !this.wizard.route)  {
    return '#' + id;
  }
  
  return Router.path(this.wizard.route, stepParams(id));
});

Template.wizard.created = function() {
  var id = this.data.id || defaultId;
  this.wizard = wizardsById[id] = new Wizard(this.data);
};

Template.wizard.destroyed = function() {
  var id = this.data.id || defaultId;

  if (wizardsById[id]) {
    wizardsById[id].destroy();
    delete wizardsById[id];
  }
};

Template.wizard.helpers({
  innerContext: function(outerContext) {
    var context = this
    , wizard = Template.instance().wizard;

    return _.extend({
      wizard: wizard,
      step: wizard.activeStep(),
    }, outerContext);
  },
  activeStepTemplate: function() {
    var activeStep = this.wizard.activeStep();
    return activeStep && (activeStep.template || '__wizard_step') || null;
  }
});

Template.__wizard_steps.events({
  'click a': function(e, tpl) {
    if (!this.wizard.route) {
      e.preventDefault();
      this.wizard.show(this.id);
    }
  }
});

Template.__wizard_steps.helpers({
  activeStepClass: function(id) { 
    var activeStep = this.wizard.activeStep();
    return (activeStep && activeStep.id == id) && 'active' || '';
  }
});

Template.__wizard_nav.events({
  'click .wizard-back-button': function(e) {
    e.preventDefault();
    this.previous();
  }
});

Template.__wizard_nav.helpers({
  showBackButton: function() {
    return this.backButton && !this.isFirstStep();
  }
});

var Wizard = function(options) {
  this._dep = new Tracker.Dependency();
  
  options = _.chain(options).pick(
    'id',
    'route',
    'steps',
    'stepsTemplate',
    'buttonClasses',
    'nextButton',
    'backButton',
    'confirmButton',
    'persist',
    'clearOnDestroy'
  ).defaults({
    stepsTemplate: '__wizard_steps',
    nextButton: 'Next',
    backButton: 'Back',
    confirmButton: 'Confirm',
    persist: true
  }).value();
  
  _.extend(this, options);
  
  if (this.route && typeof Router === 'undefined') {
    throw new Meteor.Error('iron-router-required', 'iron:router not installed');
  }
  
  this._stepsByIndex = [];
  this._stepsById = {};
  
  this.store = new CacheStore(this.id, {
    persist: this.persist !== false
  });
  
  this.initialize();
};

Wizard.prototype = {
  
  constructor: Wizard,

  initialize: function() {
    var self = this;
    
    _.each(this.steps, function(step) {
      self._initStep(step);
    });

    this._comp = Tracker.autorun(function() {
      var current, step;
      
      if (self.route) {
        current = Router.current();
        if(current && current.route.getName() === self.route) {
          step = current.params.step;
        }
      }
    
      self._setActiveStep(step);
    });
  },

  _initStep: function(step) {
    var self = this;
    
    if (!step.id) {
      throw new Meteor.Error('step-id-required', 'Step.id is required');
    }
    
    if (!step.formId) {
      step.formId = step.id + '-form';
    }
    
    this._stepsByIndex.push(step.id);
    this._stepsById[step.id] = _.extend(step, {
      wizard: self,
      data: function() {
        return self.store.get(step.id);
      }
    });

    AutoForm.addHooks([step.formId], {
      onSubmit: function(data) {
        if(step.onSubmit) {
          step.onSubmit.call(this, data, self);
        } else {
          self.next(data);
        }
        return false;
      }
    }, true);
  },
  
  _setActiveStep: function(step) {
    // show the first step if not bound to a route
    if(!step) {
      return this.show(0);
    }

    var index = this.indexOf(step)
      , previousStep = this.getStep(index - 1);

    // initial route or non existing step, redirect to first step
    if(index === -1) {
      return this.show(0);
    }
    
    // invalid step
    if(index > 0 && previousStep && !previousStep.data()) {
      return this.show(0);
    }

    // valid
    this.setStep(step);
  },
  
  setData: function(id, data) {
    this.store.set(id, data);
  },
  
  clearData: function() {
    this.store.clear();
  },
  
  mergedData: function() {
    var data = {};
    _.each(this._stepsById, function(step) {
      _.extend(data, step.data());
    });
    return data;
  },
  
  next: function(data) {
    var activeIndex = _.indexOf(this._stepsByIndex, this._activeStepId);
    
    this.setData(this._activeStepId, data);

    this.show(activeIndex + 1);
  },
  
  previous: function() {
    var activeIndex = _.indexOf(this._stepsByIndex, this._activeStepId);

    this.setData(this._activeStepId, AutoForm.getFormValues(this.activeStep(false).formId));

    this.show(activeIndex - 1);
  },
  
  show: function(id) {
    if(typeof id === 'number') {
      id = id in this._stepsByIndex && this._stepsByIndex[id];
    }

    if(!id) return false;

    if(this.route) {
      Router.go(this.route, stepParams(id));
    } else {
      this.setStep(id);
    }

    return true;
  },
  
  getStep: function(id) {
    if(typeof id === 'number') {
      id = id in this._stepsByIndex && this._stepsByIndex[id];
    }
    
    return id in this._stepsById && this._stepsById[id];
  },
  
  activeStep: function(reactive) {
    if(reactive !== false) {
      this._dep.depend();
    }
    return this._stepsById[this._activeStepId];
  },
  
  setStep: function(id) {
    this._activeStepId = id;
    this._dep.changed();
    return this._stepsById[this._activeStepId];
  },
  
  isActiveStep: function(id) {
    return id === this._activeStepId;
  },
  
  isFirstStep: function(id) {
    id = id || this._activeStepId;
    return this.indexOf(id) === 0;
  },
  
  isLastStep: function(id) {
    id = id || this._activeStepId;
    return this.indexOf(id) === this._stepsByIndex.length - 1;
  },
  
  indexOf: function(id) {
    return _.indexOf(this._stepsByIndex, id);
  },
  
  destroy: function() {
    this._comp.stop();
    
    if(this.clearOnDestroy) this.clearData();
  } 
};

Template.wizard.get = function(id) {
  return wizardsById[id || defaultId];
};