Flame.ImageView = Flame.View.extend({
    templateContext: function() {
        return { value: this.get('value') };
    }.property('value'),

    handlebars: '<img {{bind-attr src="value"}}>'
});
