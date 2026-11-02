require('dotenv').config();
const axios = require('axios');
const Member = require('../models/Members');
const Movie = require('../models/Movies');
const { Responses, membersResponses } = require('../responses/responses');
const { objectIdString } = require('../utils/objectId');
const { scalarString } = require('../utils/scalarString');
const Subscription = require('../models/Subscriptions');

const success = Responses.success;
const error = Responses.internalError;
const badRequest = Responses.badRequest;

exports.loadingMembers = async () => {
    try {
        const allMembers = await Member.find({});

        // Only hit the external API when the collection is empty (first boot / empty DB)
        if (allMembers.length === 0) {
            const { data: mockUsers } = await axios.get(process.env.MOCK_USERS_URL);

            const membersToInsert = mockUsers.map(({ name, email, address }) => ({
                name,
                email,
                city: address.city,
            }));

            // insertMany is orders of magnitude faster than sequential upserts
            const insertedMembers = await Member.insertMany(membersToInsert, { ordered: false });

            const members = insertedMembers.map((m) => ({
                _id: m._id,
                name: m.name,
                email: m.email,
                city: m.city,
                subscriptions: [],
            }));

            const { code, message } = success;
            return { code, message, members };
        }

        const subscriptions = await Subscription.find({}).populate({
            path: 'movies.movieId',
            select: 'name genres image premiered',
        });

        const members = allMembers.map((member) => {
            const memberSubscription = subscriptions.find(
                (sub) => sub.memberId.toString() === member._id.toString()
            );

            const movies = memberSubscription
                ? memberSubscription.movies.map((movie) => ({
                      movieId: movie.movieId?._id ? String(movie.movieId._id) : null,
                      name: movie.movieId?.name,
                      genres: movie.movieId?.genres,
                      image: movie.movieId?.image,
                      premiered: movie.movieId?.premiered,
                      date: movie?.date,
                  }))
                : [];

            return {
                _id: String(member._id),
                name: member.name,
                email: member.email,
                city: member.city,
                subscriptions: movies,
            };
        });

        const { code, message } = success;
        return { code, message, members };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};

exports.newMember = async (req) => {
    try {
        const { name, email, city } = req.body;
        if (scalarString(name) === null || scalarString(email) === null || scalarString(city) === null) {
            return { code: badRequest.code, message: badRequest.message };
        }
        const isMemberExists = await Member.findOne({ $or: [{ email }, { name }] });

        const { code: errorCode, message: errorMessage } = membersResponses.memberExists;
        if (isMemberExists?.email === email) return { code: errorCode, message: errorMessage };

        const { code: nameErrorCode, message: nameErrorMessage } = membersResponses.usernameAlreadyTaken;
        if (isMemberExists?.name === name) return { code: nameErrorCode, message: nameErrorMessage };

        const member = await new Member({ name, email, city }).save();

        const { code, message } = success;
        return { code, message, member };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};

exports.newSubscription = async (req) => {
    try {
        const { movieId, date, memberId } = req.body;
        const memberKey = objectIdString(memberId);
        if (!memberKey) {
            const { code: errorCode, message: errorMessage } = membersResponses.notExistingMember;
            return { code: errorCode, message: errorMessage };
        }
        const movieKey = objectIdString(movieId);
        if (!movieKey) {
            return { code: badRequest.code, message: 'Movie not found' };
        }

        const isMemberExists = await Member.findById(memberKey);
        if (!isMemberExists) {
            const { code: errorCode, message: errorMessage } = membersResponses.notExistingMember;
            return { code: errorCode, message: errorMessage };
        }

        const movieExists = await Movie.findById(movieKey);
        if (!movieExists) {
            return { code: badRequest.code, message: 'Movie not found' };
        }

        const subscription = await Subscription.findOneAndUpdate(
            { memberId: memberKey },
            { $push: { movies: { movieId: movieKey, date } } },
            { new: true, upsert: true }
        ).populate({
            path: 'movies.movieId',
            select: 'name genres image premiered',
        });

        const memberWithSubscriptions = {
            _id: String(isMemberExists._id),
            name: isMemberExists.name,
            email: isMemberExists.email,
            city: isMemberExists.city,
            subscriptions: subscription.movies
                .filter((movie) => movie.movieId != null)
                .map((movie) => ({
                    movieId: String(movie.movieId._id),
                    name: movie.movieId?.name,
                    date: movie.date,
                })),
        };

        const { code, message } = success;
        return { code, message, member: memberWithSubscriptions };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};

exports.editMember = async (req) => {
    try {
        const { _id, name, email, city } = req.body;
        const id = objectIdString(_id);
        if (!id) {
            const { code, message } = membersResponses.memberNotFound;
            return { code, message };
        }
        if (scalarString(name) === null || scalarString(email) === null || scalarString(city) === null) {
            return { code: badRequest.code, message: badRequest.message };
        }

        const isMemberExists = await Member.exists({ name, _id: { $ne: id } });

        const { code: errorCodeMember, message: errorMessageMember } = membersResponses.usernameAlreadyTaken;
        if (isMemberExists) return { code: errorCodeMember, message: errorMessageMember };

        const emailConflict = await Member.findOne({ email, _id: { $ne: id } });
        const { code: errorCodeEmail, message: errorMessageEmail } = membersResponses.memberExists;
        if (emailConflict) return { code: errorCodeEmail, message: errorMessageEmail };

        const member = await Member.findOneAndUpdate(
            { _id: id },
            { name, email, city },
            { new: true }
        );

        const { code: errorCode, message: errorMessage } = membersResponses.memberNotFound;
        if (!member) return { code: errorCode, message: errorMessage };

        // Use member._id (ObjectId from DB) not _id (string from req.body) to avoid cast issues
        const existingSub = await Subscription.findOne({ memberId: member._id }).populate({
            path: 'movies.movieId',
            select: 'name',
        });

        const reshapedSubscriptions = existingSub
            ? existingSub.movies
                  .filter((movie) => movie.movieId != null)
                  .map((movie) => ({
                      movieId: movie.movieId._id,
                      name: movie.movieId.name,
                      date: movie.date,
                  }))
            : [];

        const memberWithSubscriptions = {
            _id: String(member._id),
            name: member.name,
            email: member.email,
            city: member.city,
            subscriptions: reshapedSubscriptions,
        };

        const { code, message } = success;
        return { code, message, member: memberWithSubscriptions };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};

exports.deleteMember = async (req) => {
    try {
        const { id } = req.query;
        const memberKey = objectIdString(id);
        const { code: errorCode, message: errorMessage } = membersResponses.memberNotDeleted;
        if (!memberKey) return { code: errorCode, message: errorMessage };

        const isMemberExists = await Member.deleteOne({ _id: memberKey });

        if (isMemberExists.deletedCount === 0) return { code: errorCode, message: errorMessage };

        await Subscription.deleteOne({ memberId: memberKey });

        const members = await Member.find({});
        const { code, message } = success;
        return { code, message, members };
    } catch (err) {
        const { code, message } = error;
        console.error(err.message);
        return { code, message };
    }
};
