import { Client, Intents } from 'discord.js';
import makrut from 'makrut';

import(process.argv[2] ?? './config.js').then(({ default: config }) => {

	const logger = makrut(config.logLevel);

	const EMOJI_REGEX = new RegExp(/.*?(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:[^>]+>)/);

	const mkRoleMap = message => {
		const roleMap = new Map();
		message.content.split(`\n`).forEach(line => {
			message.mentions.roles.forEach(role => {
				if (line.match(`.*${role}.*`)) {
					logger.debug(`role found in '${line}'`);
					const matches = line.match(EMOJI_REGEX);
					if (matches) {
						logger.debug(`Emoji is ${matches[1]}`);
						roleMap.set(matches[1], role);
					}
				}
			});
		});
		return roleMap;
	};

	const changeRole = (roleMap, action) => async (reaction, user) => {
		logger.debug(`${user.username}#${user.discriminator} [${action}] ${reaction.emoji}`);
		if (user.bot) {
			logger.debug('Reaction added by a bot user');
			return;
		}
		const role = roleMap.get(reaction.emoji.toString());
		if (role?.editable) {
			await role.guild.members.fetch();
			role.guild.members.resolve(user).roles[action](role);
		}
	};

	const mkReactionWatchers = message => {
		const roleMap = mkRoleMap(message);

		return {
			add: changeRole(roleMap, 'add'),
			remove: changeRole(roleMap, 'remove'),
			roleMap,
		};
	};

	const watchEdits = (reactionWatchers, message) => {
		const editWatcher = (oldMessage, newMessage) => {
			if (oldMessage.id !== message.id) return;

			logger.info(`Role message in "${oldMessage.guild.name} <${oldMessage.guild.id}>" was updated`);
			logger.debug(`Removing watchers from ${message.url}`);
			client
				.removeListener('messageReactionAdd', reactionWatchers.add)
				.removeListener('messageReactionRemove', reactionWatchers.remove)
				.removeListener('messageUpdate', editWatcher);
			watchMessage(newMessage);
		};
		return editWatcher;
	};

	const processExistingReactions = async (message, roleMap) => {
		for (const emoji of roleMap.keys()) {
			try {
				await message.react(emoji);
			} catch (err) {
				logger.error(`Failed to react ${emoji} to ${message.url}`, err);
			}
		}
		message.reactions.cache.forEach(async reaction => {
			if (Array.from(roleMap.keys()).includes(reaction.emoji.toString())) {
				await reaction.users.fetch();
				reaction.users.cache.forEach(user => {
					changeRole(roleMap, 'add')(reaction, user)
				});
			} else if (reaction.me) {
				logger.debug(`Removing old self reaction ${reaction.emoji}`);
				reaction.users.remove(client.user);
			}
		});
	};

	const watchMessage = message => {
		logger.debug(`Adding watchers to ${message.url}`);
		const reactionWatchers = mkReactionWatchers(message);
		processExistingReactions(message, reactionWatchers.roleMap);
		client
			.on('messageReactionAdd', reactionWatchers.add)
			.on('messageReactionRemove', reactionWatchers.remove)
			.on('messageUpdate', watchEdits(reactionWatchers, message));
	};

	const cacheAndWatch = async ({ channel, id }) => {
		client.channels.fetch(channel)
			.catch(err => {
				logger.error(`Error occured while accessing channel ${channel}`, err);
			})
			.then(c => c && c.messages.fetch(id))
			.catch(err => {
				logger.error(`Error occured while getting the message: ${channel}/${id}`, err);
			})
			.then(m => m && watchMessage(m));
	};

	const client = new Client({
		intents: [
			Intents.FLAGS.GUILD_MEMBERS,
			Intents.FLAGS.GUILDS,
			Intents.FLAGS.GUILD_MESSAGES,
			Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
		]
	});

	client.on('ready', async () => {
		logger.info(`logged in as ${client.user.tag}`);
		config.messages.forEach(cacheAndWatch);
	});

	client.login(config.token);
});
