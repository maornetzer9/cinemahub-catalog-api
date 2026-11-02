require('dotenv').config();
const Movie = require('../models/Movies');
const axios = require('axios');
const Subscription = require('../models/Subscriptions');
const { Responses, moviesResponses } = require('../responses/responses');
const { objectIdString } = require('../utils/objectId');
const { scalarString } = require('../utils/scalarString');

const success = Responses.success;
const error = Responses.internalError;

exports.loadingMovies = async (req) => {
    try {
        const allMovies = await Movie.find({});

        // Only hit the external API when the collection is empty (first boot / empty DB)
        if (allMovies.length === 0) {
            const { data } = await axios.get(process.env.MOCK_MOVIES_URL);

            const moviesToInsert = data.map(({ name, genres, image, premiered }) => ({
                name,
                genres,
                image: image.original,
                premiered,
            }));

            // insertMany is orders of magnitude faster than 230 sequential upserts
            const insertedMovies = await Movie.insertMany(moviesToInsert, { ordered: false });

            const { code, message } = success;
            return { code, message, movies: insertedMovies };
        }

        const { code, message } = success;
        return { code, message, movies: allMovies };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};

exports.editMovie = async (req) => {
    try {
        const { _id, name, genres, image, premiered } = req.body;
        const id = objectIdString(_id);
        if (!id) return { code: Responses.badRequest.code, message: 'Invalid movie id.' };
        if (scalarString(name) === null) {
            return { code: Responses.badRequest.code, message: Responses.badRequest.message };
        }

        const isMovieExists = await Movie.exists({ name, _id: { $ne: id } });

        const { code: errorCode, message: errorMessage } = moviesResponses.movieNameTaken;
        if (isMovieExists !== null) return { code: errorCode, message: errorMessage };

        const movie = await Movie.findOneAndUpdate(
            { _id: id },
            { name, genres, image, premiered },
            { new: true }
        );

        const movies = await Movie.find({});

        const { code, message } = success;
        return { code, message, movie, movies };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};

exports.addMovie = async (req) => {
    try {
        const { name, genres, image, premiered } = req.body;
        if (scalarString(name) === null) {
            return { code: Responses.badRequest.code, message: Responses.badRequest.message };
        }

        const isMovieExists = await Movie.findOne({ name });

        const { code: errorCode, message: errorMessage } = moviesResponses.movieNameTaken;
        if (isMovieExists) return { code: errorCode, message: errorMessage };

        const movie = await new Movie({ name, genres, image, premiered }).save();

        const { code, message } = success;
        return { code, message, movie };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};

exports.deleteMovie = async (req) => {
    try {
        const { _id } = req.query;
        const id = objectIdString(_id);
        const { code: errorCode, message: errorMessage } = moviesResponses.movieNotDeleted;
        if (!id) return { code: errorCode, message: errorMessage };

        const movie = await Movie.deleteOne({ _id: id });

        if (movie.deletedCount <= 0) return { code: errorCode, message: errorMessage };

        await Subscription.updateMany({}, { $pull: { movies: { movieId: id } } });

        const movies = await Movie.find({});

        const { code, message } = success;
        return { code, message, movies };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};
