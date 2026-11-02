const { loadingMovies, editMovie, addMovie, deleteMovie } = require("../services/movies");

exports.loadingMoviesController = async (req, res, next) => {
    try
    {
        const response = await loadingMovies(req);
        return res.status(200).json(response);
    }
    catch(err)
    {
        next(err)
    }
};

exports.editMovieController = async (req, res, next) => {
    try
    {
        const response = await editMovie(req);
        return res.status(200).json(response);
    }
    catch(err)
    {
       next(err)
    }
};

exports.addMovieController = async (req, res, next) => {
    try
    {
        const response = await addMovie(req);
        return res.status(200).json(response);
    }
    catch(err)
    {
       next(err)
    }
};

exports.deleteMovieController = async (req, res, next) => {
    try
    {
        const response = await deleteMovie(req);
        return res.status(200).json(response);
    }
    catch(err)
    {
        next(err)
    }
};
