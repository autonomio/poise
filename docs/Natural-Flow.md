# Natural flow

Poise uses the Tactile spring selected in Eight-Characters: stiffness 180,
damping 20 and mass 1. The pure presentation model in
`gateway/src/motion-model.ts` supplies both the browser integrator and CSS
curve. `src/motion.ts` owns live channels, retaining position and velocity
when a destination changes. Completion belongs to the latest request.

Archive reorders retained rows with that channel instead of independent
700ms transitions and cleanup timers. Reduced motion removes animation and
its delays. Preference changes, viewport resizing, printing and hiding the
document settle active spatial channels; hidden scrolling is cancelled.

The model tests verify reversal momentum, actual settling and invalid input.
Browser interaction coverage belongs alongside each controller integration.
