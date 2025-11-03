module.exports = function (router) {

    var mongoose = require('mongoose');
    var User = require('../models/user');
    var Task = require('../models/task');

    

    function parseJSONParam(paramValue, paramName, res) {
        if (paramValue === undefined) return { ok: true, value: undefined };
        try {
            return { ok: true, value: JSON.parse(paramValue) };
        } catch (e) {
            res.status(400).json({ message: 'Invalid JSON for "' + paramName + '" parameter', data: {} });
            return { ok: false };
        }
    }

    function parseBooleanParam(value) {
        if (value === undefined) return false;
        if (typeof value === 'boolean') return value;
        return String(value).toLowerCase() === 'true';
    }

    function parseBooleanBody(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            var lower = value.toLowerCase();
            if (lower === 'true') return true;
            if (lower === 'false') return false;
        }
        return !!value;
    }

    function parseDeadlineValue(value) {
        if (value === undefined || value === null) return null;
        var num = Number(value);
        if (!Number.isNaN(num) && Number.isFinite(num)) {
            var ms = Math.round(num);
            var d1 = new Date(ms);
            if (!Number.isNaN(d1.getTime())) return d1;
        }
        var d2 = new Date(value);
        if (!Number.isNaN(d2.getTime())) return d2;
        return null;
    }

    var homeRoute = router.route('/');
    homeRoute.get(function (req, res) {
        var connectionString = process.env.TOKEN;
        res.json({ message: 'My connection string is ' + connectionString });
    });

    router.route('/users')
        .get(async function (req, res) {
            var whereP = parseJSONParam(req.query.where, 'where', res);
            if (!whereP.ok) return;
            var sortP = parseJSONParam(req.query.sort, 'sort', res);
            if (!sortP.ok) return;
            var selectP = parseJSONParam(req.query.select, 'select', res);
            if (!selectP.ok) return;

            var skip = req.query.skip ? parseInt(req.query.skip, 10) : 0;
            if (Number.isNaN(skip) || skip < 0) skip = 0;
            var limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : undefined;
            if (limit !== undefined && (Number.isNaN(limit) || limit < 0)) limit = undefined;
            var count = parseBooleanParam(req.query.count);

            try {
                if (count) {
                    var total = await User.countDocuments(whereP.value || {}).exec();
                    return res.status(200).json({ message: 'OK', data: total });
                }

                var query = User.find(whereP.value || {});
                if (sortP.value) query = query.sort(sortP.value);
                if (selectP.value) query = query.select(selectP.value);
                if (skip) query = query.skip(skip);
                if (limit !== undefined) query = query.limit(limit);

                var users = await query.exec();
                return res.status(200).json({ message: 'OK', data: users });
            } catch (e) {
                return res.status(500).json({ message: 'Server error', data: {} });
            }
        })
        .post(async function (req, res) {
            try {
                if (!req.body || !req.body.name || !req.body.email) {
                    return res.status(400).json({ message: 'User name and email are required', data: {} });
                }

                var user = new User({
                    name: req.body.name,
                    email: req.body.email,
                    pendingTasks: []
                });

                var saved = await user.save();
                return res.status(201).json({ message: 'User created', data: saved });
            } catch (e) {
                if (e && e.code === 11000) {
                    return res.status(400).json({ message: 'A user with that email already exists', data: {} });
                }
                return res.status(400).json({ message: 'Unable to create user', data: {} });
            }
        });

    router.route('/users/:id')
        .get(async function (req, res) {
            var selectP = parseJSONParam(req.query.select, 'select', res);
            if (!selectP.ok) return;
            try {
                var query = User.findById(req.params.id);
                if (selectP.value) query = query.select(selectP.value);
                var user = await query.exec();
                if (!user) return res.status(404).json({ message: 'User not found', data: {} });
                return res.status(200).json({ message: 'OK', data: user });
            } catch (e) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }
        })
        .put(async function (req, res) {
            try {
                var user = await User.findById(req.params.id).exec();
                if (!user) return res.status(404).json({ message: 'User not found', data: {} });

                var name = req.body && req.body.name;
                var email = req.body && req.body.email;
                if (!name || !email) return res.status(400).json({ message: 'User name and email are required', data: {} });

                var newPending = Array.isArray(req.body.pendingTasks) ? req.body.pendingTasks.map(String) : [];

                if (newPending.length > 0) {
                    var tasks = await Task.find({ _id: { $in: newPending } }).exec();
                    if (tasks.length !== newPending.length) {
                        return res.status(400).json({ message: 'One or more tasks in pendingTasks do not exist', data: {} });
                    }
                    var invalid = tasks.find(function (t) { return t.completed === true || (t.assignedUser && t.assignedUser !== String(user._id)); });
                    if (invalid) {
                        return res.status(400).json({ message: 'pendingTasks must be incomplete and not assigned to a different user', data: {} });
                    }
                }

                if (newPending.length > 0) {
                    await Task.updateMany(
                        { _id: { $in: newPending } },
                        { $set: { assignedUser: String(user._id), assignedUserName: name } }
                    ).exec();
                }

                await Task.updateMany(
                    { assignedUser: String(user._id), completed: false, _id: { $nin: newPending } },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
                ).exec();

                user.name = name;
                user.email = email;
                user.pendingTasks = newPending;
                var savedUser = await user.save();
                return res.status(200).json({ message: 'User updated', data: savedUser });
            } catch (e) {
                if (e && e.code === 11000) {
                    return res.status(400).json({ message: 'A user with that email already exists', data: {} });
                }
                return res.status(400).json({ message: 'Unable to update user', data: {} });
            }
        })
        .delete(async function (req, res) {
            try {
                var user = await User.findById(req.params.id).exec();
                if (!user) return res.status(404).json({ message: 'User not found', data: {} });

                await Task.updateMany(
                    { assignedUser: String(user._id) },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
                ).exec();

                await User.deleteOne({ _id: user._id }).exec();
                return res.status(200).json({ message: 'User deleted', data: {} });
            } catch (e) {
                return res.status(400).json({ message: 'Unable to delete user', data: {} });
            }
        });

    router.route('/tasks')
        .get(async function (req, res) {
            var whereP = parseJSONParam(req.query.where, 'where', res);
            if (!whereP.ok) return;
            var sortP = parseJSONParam(req.query.sort, 'sort', res);
            if (!sortP.ok) return;
            var selectP = parseJSONParam(req.query.select, 'select', res);
            if (!selectP.ok) return;

            var skip = req.query.skip ? parseInt(req.query.skip, 10) : 0;
            if (Number.isNaN(skip) || skip < 0) skip = 0;
            var limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 100; 
            if (Number.isNaN(limit) || limit < 0) limit = 100;
            var count = parseBooleanParam(req.query.count);

            try {
                if (count) {
                    var total = await Task.countDocuments(whereP.value || {}).exec();
                    return res.status(200).json({ message: 'OK', data: total });
                }

                var query = Task.find(whereP.value || {});
                if (sortP.value) query = query.sort(sortP.value);
                if (selectP.value) query = query.select(selectP.value);
                if (skip) query = query.skip(skip);
                if (limit !== undefined) query = query.limit(limit);

                var tasks = await query.exec();
                return res.status(200).json({ message: 'OK', data: tasks });
            } catch (e) {
                return res.status(500).json({ message: 'Server error', data: {} });
            }
        })
        .post(async function (req, res) {
            try {
                if (!req.body || !req.body.name || !req.body.deadline) {
                    return res.status(400).json({ message: 'Task name and deadline are required', data: {} });
                }

                var assignedUserId = req.body.assignedUser ? String(req.body.assignedUser) : '';
                var assignedUserName = 'unassigned';

                if (assignedUserId) {
                    var assignedUser = await User.findById(assignedUserId).exec();
                    if (!assignedUser) return res.status(400).json({ message: 'assignedUser is invalid', data: {} });
                    assignedUserName = assignedUser.name;
                }

                var parsedDeadline = parseDeadlineValue(req.body.deadline);
                if (!parsedDeadline) return res.status(400).json({ message: 'Invalid deadline value', data: {} });

                var task = new Task({
                    name: req.body.name,
                    description: req.body.description || '',
                    deadline: parsedDeadline,
                    completed: parseBooleanBody(req.body.completed),
                    assignedUser: assignedUserId,
                    assignedUserName: assignedUserName
                });

                var savedTask = await task.save();

                if (assignedUserId && savedTask.completed === false) {
                    await User.updateOne(
                        { _id: assignedUserId },
                        { $addToSet: { pendingTasks: String(savedTask._id) } }
                    ).exec();
                }

                return res.status(201).json({ message: 'Task created', data: savedTask });
            } catch (e) {
                return res.status(400).json({ message: 'Unable to create task', data: {} });
            }
        });

    router.route('/tasks/:id')
        .get(async function (req, res) {
            var selectP = parseJSONParam(req.query.select, 'select', res);
            if (!selectP.ok) return;
            try {
                var query = Task.findById(req.params.id);
                if (selectP.value) query = query.select(selectP.value);
                var task = await query.exec();
                if (!task) return res.status(404).json({ message: 'Task not found', data: {} });
                return res.status(200).json({ message: 'OK', data: task });
            } catch (e) {
                return res.status(404).json({ message: 'Task not found', data: {} });
            }
        })
        .put(async function (req, res) {
            try {
                var task = await Task.findById(req.params.id).exec();
                if (!task) return res.status(404).json({ message: 'Task not found', data: {} });

                var name = req.body && req.body.name;
                var deadline = req.body && req.body.deadline;
                if (!name || !deadline) return res.status(400).json({ message: 'Task name and deadline are required', data: {} });

                var description = req.body.description || '';
                var completed = parseBooleanBody(req.body.completed);
                var newAssignedUserId = req.body.assignedUser ? String(req.body.assignedUser) : '';
                var newAssignedUserName = 'unassigned';

                var oldAssignedUserId = task.assignedUser ? String(task.assignedUser) : '';

                if (newAssignedUserId) {
                    var newAssignedUser = await User.findById(newAssignedUserId).exec();
                    if (!newAssignedUser) return res.status(400).json({ message: 'assignedUser is invalid', data: {} });
                    newAssignedUserName = newAssignedUser.name;
                }

                var parsedDeadline2 = parseDeadlineValue(deadline);
                if (!parsedDeadline2) return res.status(400).json({ message: 'Invalid deadline value', data: {} });

                task.name = name;
                task.description = description;
                task.deadline = parsedDeadline2;
                task.completed = completed;
                task.assignedUser = newAssignedUserId;
                task.assignedUserName = newAssignedUserName;

                var savedTask = await task.save();

                if (oldAssignedUserId) {
                    await User.updateOne(
                        { _id: oldAssignedUserId },
                        { $pull: { pendingTasks: String(savedTask._id) } }
                    ).exec();
                }

                if (newAssignedUserId && savedTask.completed === false) {
                    await User.updateOne(
                        { _id: newAssignedUserId },
                        { $addToSet: { pendingTasks: String(savedTask._id) } }
                    ).exec();
                }

                return res.status(200).json({ message: 'Task updated', data: savedTask });
            } catch (e) {
                return res.status(400).json({ message: 'Unable to update task', data: {} });
            }
        })
        .delete(async function (req, res) {
            try {
                var task = await Task.findById(req.params.id).exec();
                if (!task) return res.status(404).json({ message: 'Task not found', data: {} });

                if (task.assignedUser) {
                    await User.updateOne(
                        { _id: String(task.assignedUser) },
                        { $pull: { pendingTasks: String(task._id) } }
                    ).exec();
                }

                await Task.deleteOne({ _id: task._id }).exec();
                return res.status(200).json({ message: 'Task deleted', data: {} });
            } catch (e) {
                return res.status(400).json({ message: 'Unable to delete task', data: {} });
            }
        });

    return router;
}
