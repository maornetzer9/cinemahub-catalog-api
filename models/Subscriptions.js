const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const SubscriptionSchema = new mongoose.Schema({
    memberId: {
        type: ObjectId,
        ref: 'Member', // Reference to the Member collection
        required: true
    },
    movies: [
        {
            movieId: {
                type: ObjectId,
                ref: 'Movie', 
                required: true
            },
            date: {
                type: Date,
                required: true
            }
        }
    ]
});

const Subscription = mongoose.model('Subscription', SubscriptionSchema);
module.exports = Subscription;
