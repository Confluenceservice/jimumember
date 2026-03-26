Recommended Implementation
Your scenario requires conditional logic that Stripe doesn't natively support in a single subscription. You'll need to implement this using a combination of approaches:
Option 1: Application-Level Logic (Recommended)
Handle the conditional logic in your application code when creating subscriptions:
Create two prices for your annual subscription:
Full annual price (e.g., 100 NZD)
50% discounted price (e.g., 50 NZD)
When a customer subscribes between Jan-Jun:
Check if they're a first-time subscriber
Check if they're using promo code LDTY8PQR
If both conditions are true: Create subscription with the 50% price and set billing_cycle_anchor to next 1 July
Otherwise: Create subscription with full price and set billing_cycle_anchor to next 1 July
Set billing cycle anchor to 1 July:
// Calculate next July 1st
const now = new Date();
const nextJuly = new Date(now.getFullYear(), 6, 1); // Month is 0-indexed
if (now > nextJuly) {
  nextJuly.setFullYear(nextJuly.getFullYear() + 1);
}

const subscription = await stripe.subscriptions.create({
  customer: customerId,
  items: [{ price: selectedPriceId }],
  billing_cycle_anchor_config: {
    day_of_month: 1,
    month: 7
  },
  proration_behavior: 'create_prorations' // Charges prorated amount until July 1
});
Option 2: Using Coupons with Subscription Schedules
Create a 50% off coupon with duration: 'once'
Create the promotion code LDTY8PQR linked to this coupon
Use a subscription schedule to manage the transition:
Phase 1: Discounted period until next 1 July (with coupon applied)
Phase 2: Full annual billing starting 1 July
This approach requires checking eligibility (Jan-Jun signup + first-time subscriber) in your application before applying the promo code.
Key Considerations
Proration: When setting billing_cycle_anchor to 1 July, Stripe automatically prorates the first payment for the period between subscription creation and 1 July
First-time subscriber tracking: Store this in your database or use Stripe metadata, as Stripe doesn't track "first subscription" status automatically
Date range validation: Your application must validate the Jan-Jun signup window

Option 2 with Subscription Schedules is better suited to avoid automatic proration. Here's the recommended implementation:
Best Implementation: Subscription Schedules with Coupons
Step 1: Create a 50% off coupon
Create a coupon with percent_off: 50 and duration: 'once'
Create promotion code LDTY8PQR linked to this coupon
Step 2: Create the subscription schedule
When a customer subscribes between Jan-Jun with the promo code:
const stripe = require('stripe')('sk_test_...');

// Calculate next July 1st
const now = new Date();
const nextJuly = new Date(Date.UTC(now.getUTCFullYear(), 6, 1)); // July 1
if (now > nextJuly) {
  nextJuly.setUTCFullYear(nextJuly.getUTCFullYear() + 1);
}
const nextJulyTimestamp = Math.floor(nextJuly.getTime() / 1000);

// Create subscription schedule with two phases
const schedule = await stripe.subscriptionSchedules.create({
  customer: customerId,
  start_date: 'now',
  end_behavior: 'release',
  phases: [
    {
      // Phase 1: Discounted period until July 1
      items: [{
        price: annualPriceId,
        quantity: 1,
      }],
      coupon: couponId, // 50% off coupon
      end_date: nextJulyTimestamp,
      proration_behavior: 'none', // No proration
    },
    {
      // Phase 2: Full annual billing from July 1 onwards
      items: [{
        price: annualPriceId,
        quantity: 1,
      }],
      iterations: 1, // One full year
      proration_behavior: 'none', // No proration
    },
  ],
});
Step 3: Handle eligibility in your application
Your application code must check:
Current date is between Jan 1 - Jun 30
Customer is a first-time subscriber (track this in your database or Stripe metadata)
Promo code LDTY8PQR is provided
How this works:
Phase 1 (Now → July 1): Customer pays 50% of annual amount immediately, no proration
Phase 2 (July 1 → July 1 next year): Customer pays full annual amount on July 1
Key benefits:
proration_behavior: 'none' prevents automatic proration
Subscription schedule manages the transition automatically
Customer is charged the exact amounts you specify
Billing cycle anchor is naturally set to July 1 after Phase 1 ends