const mongoose = require('mongoose');

const MovieSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    genres: {
        type: [String],
        required: true
    },
    image: {
        type: String, 
        required: true
    },
    premiered: {
        type: Date,
        required: true
    }
});

const Movie = mongoose.model('Movie', MovieSchema);
module.exports = Movie;
