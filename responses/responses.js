exports.Responses = {
    success         : { code: 200, message: "Success" },
    badRequest      : { code: 400, message: "Bad Request" },
    unauthorized    : { code: 401, message: "Unauthorized" },
    forbidden       : { code: 403, message: "Forbidden" },
    internalError   : { code: 500, message: "Internal Server Error" },
};

exports.membersResponses = {
    memberExists             : { code: 1, message: 'This member is already exists' },
    notExistingMember        : { code: 2, message: 'This member not exists' },
    memberNotFound           : { code: 3, message: 'This member not found' },
    memberNotDeleted         : { code: 4, message: 'This member is not deleted' },
    usernameAlreadyTaken     : { code: 5, message: 'Username already taken' },
};

exports.moviesResponses = {
    movieNotDeleted          : { code: 1, message: 'Cannot delete movie' },
    movieNameTaken           : { code: 2, message: 'Movie name already taken' }
};

exports.sessionResponses = {
   sessionExpired  :  { code: 401, message: "Session expired. Please log in again." },
}
