// ---- Label system (simplified — app.js manages the single route label) ----

(function() {
    var SR = window.SkyRoutes || {};

    SR.labelSystem = {
        init: function() {
            // Labels overlay exists in HTML, managed by app.js
        },
        update: function() {
            // Handled in app.js updateLabel()
        }
    };

    window.SkyRoutes = SR;
})();
