const { loadingMembers, newMember, deleteMember, editMember, newSubscription } = require("../services/members");

exports.loadMembersController = async (req, res, next) => {
    try
    {
        const response = await loadingMembers(req);
        return res.status(200).json(response);
    }
    catch(err)
    {
        next(err);
    }
};


exports.newMemberController = async (req, res, next) => {
    try
    {
        const response = await newMember(req);
        return res.status(200).json(response); 
    }
    catch(err)
    {
        next(err);
    }
};


exports.newSubscriptionController = async (req, res, next) => {
    try
    {
        const response = await newSubscription(req);
        return res.status(200).json(response); 
    }
    catch(err)
    {
        next(err);
    }
};


exports.editMemberController = async (req, res, next) => {
    try
    {
        const response = await editMember(req);
        return res.status(200).json(response); 
    }
    catch(err)
    {
        next(err);
    }
};


exports.deleteMemberController = async (req, res, next) => {
    try
    {
        const response = await deleteMember(req);
        return res.status(200).json(response); 
    }
    catch(err)
    {
        next(err);
    }
};
