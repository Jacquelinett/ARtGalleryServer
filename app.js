const ResourceType = Object.freeze({
    IMAGE: 0, 
    SOUND: 1, 
    VIDEO: 2
});

const hidden = require('./config.js'); // <- to access
const saltRounds = 10;

let app = require('http').createServer();
let firebase = require('firebase');
let io = require('socket.io')(app);
let bcrypt = require('bcrypt');

let fs = require('fs');

firebase.initializeApp(hidden.config);

let database = firebase.database();

let currentRooms = {};

let currentEditor = [];
let peopleInRoom = [];

let imageCount = 0;
let soundCount = 0;
let videoCount = 0;

let currentFree = [];
currentFree[ResourceType.IMAGE] = [];
currentFree[ResourceType.SOUND] = [];
currentFree[ResourceType.VIDEO] = [];

console.log("Checking images...");
while (fs.existsSync(imageCount + ".png")) {
    imageCount++;
}
console.log("Found " + imageCount + " images");

console.log("Checking sounds...");
while (fs.existsSync(soundCount + ".mp3")) {
    soundCount++;
}
console.log("Found " + soundCount + " sounds");

console.log("Checking videos...");
while (fs.existsSync(videoCount + ".mp4")) {
    videoCount++;
}
console.log("Found " + videoCount + " videos");

database.ref().child("freed_resource/images").once('value', function(snapshot) {
    snapshot.forEach(function(childSnapshot) {
        currentFree[ResourceType.IMAGE].push(childSnapshot.val().value);
    });

    console.log("Current free images are: " + currentFree[ResourceType.IMAGE]);
})

database.ref().child("freed_resource/sounds").once('value', function(snapshot) {
    snapshot.forEach(function(childSnapshot) {
        currentFree[ResourceType.SOUND].push(childSnapshot.val().value);
    });

    console.log("Current free sounds are: " + currentFree[ResourceType.SOUND]);
})

database.ref().child("freed_resource/videos").once('value', function(snapshot) {
    snapshot.forEach(function(childSnapshot) {
        currentFree[ResourceType.video].push(childSnapshot.val().value);
    });

    console.log("Current free videos are: " + currentFree[ResourceType.VIDEO]);
})

console.log("Listening on port 8900");
app.listen(8900);

io.on('connection', function(socket) {
    console.log("A new user connected");

    socket.on('joinRoom', function(name) {
        joinRoom(socket, name);
    });

    socket.on('editRoom', function(name, password) {
        editRoom(socket, name, password);
    });

    socket.on('deleteRoom', function(name) {
        deleteRoom(socket, name);
    });

    socket.on('renameRoom', function(oldName, newName) {
        renameRoom(socket, oldName, newName);
    });

    socket.on('addARObject', function(cloudID, image, scale, type) {
        createARObject(socket, cloudID, image, scale, type);
    });

    socket.on('removeARObject', function(cloudID, type) {
        removeARObject(socket, cloudID, type);
    })

    socket.on('requestARResource', function(resource, type) {
        requestARResource(socket, resource, type);
    })

    socket.on('test', function (data) {
        console.log("Got test");
    });

    socket.on('disconnect', function () {  
        if (currentEditor.indexOf(socket.id) >= 0)
            currentEditor.splice(currentEditor.indexOf(socket.id), 1);
    });
});

function editRoom(socket, name, password) {
    let ref = database.ref();

    roomExist(name, function(result) {
        if (result.exists()) {
            ref.child("room_list/" + name).once('value', function(snapshot) {
                let hash = snapshot.val().hash;
                // Check if password match up
                bcrypt.compare(password, hash, function(err, result) {
                    if (result == true) {
                        loadRoom(name, function(data) {
                            socket.emit("roomData", data);
                            currentEditor[socket.id] = name;
                        });
                    } else {
                        socket.emit("wrongPassword");
                    }
                });
            })
        } else {
            createRoom(socket, name, password);
        }
    })
}

function joinRoom(socket, name) {
    console.log("Join room function calling");
    roomExist(name, function(result) {
        console.log("Inside the call back");
        if (result.exists()) {
            loadRoom(name, function(data) {
                console.log("Sending room");
                socket.emit("roomData", data);
            });
        } else {
            socket.emit("roomDoesntExist");
        }
    })
}

function loadRoom(name, callback) {
    console.log("Loading room " + name);

    let ref = database.ref();
    ref.child("room_list/" + name).once('value', function(snapshot) {
        callback(snapshot);
    });
}

function roomExist(name, callback) {
    let ref = database.ref();
    ref.child("room_names").orderByChild("unique_name").equalTo(name).once('value', function(snapshot) {
        console.log("Found room");
        callback(snapshot);
    })
}

function createRoom(socket, name, password, existingData) {
    let newRoom = {};
    let ref = database.ref();

    ref.child("room_names").push({unique_name: name});
    
    newRoom.name = name;
    if (typeof existingData === 'undefined') {
        newRoom.object_list = [];

        bcrypt.hash(password, saltRounds, function(err, hash) {
            newRoom.hash = hash;
    
            ref.child("room_list/" + name).set(newRoom);

            if (socket != null) {
                loadRoom(name, function(data) {
                    console.log("Sending room");
                    socket.emit("roomData", data);
                    currentEditor[socket.id] = name;
                });
            }
        });
    } else {
        newRoom.object_list = existingData.object_list;
        newRoom.hash = existingData.hash;

        ref.child("room_list/" + name).set(newRoom);
    }
}

function renameRoom(socket, newName) {
    let ref = database.ref();

    roomExist(newName, function(result) {
        if (result.exists()) {
            socket.emit("roomWithNewNameAlreadyExist");
        } else {
            ref.child("room_list/" + currentEditor[socket.id]).once('value', function(snapshot) {
                let existingData = {
                    object_list: snapshot.val().object_list,
                    hash: snapshot.val().hash
                }
        
                createRoom(null, newName, "", existingData);
                deleteRoom(null, currentEditor[socket.id]);
    
                socket.emit("roomRenamed");
                currentEditor[socket.id] = newName;
            });
        }
    })
}

function deleteRoom(socket, name) {
    let ref = database.ref();

    ref.child("room_list/" + name + "/object_list").once("value").then(function(snapshot) {
        snapshot.forEach(function(snap){
            switch (snap.val().type) {
            case ResourceType.IMAGE:
                ref.child("freed_resource/images").push({value: snap.val().resource_identifier});
                break;
            case ResourceType.SOUND:
                ref.child("freed_resource/sounds").push({value: snap.val().resource_identifier});
                break;
            case ResourceType.VIDEO:
                ref.child("freed_resource/videos").push({value: snap.val().resource_identifier});
                break;
            }
            
            currentFree[snap.val().type].push(snap.val().resource_identifier);
        }); 

        ref.child("room_list/" + name).remove();
        const r = ref.child("room_names").orderByChild("unique_name").equalTo(name);
        const e = r.on('child_added', function(snap) {
            r.off('child_added', e);
            snap.ref.set(null);
        });

        if (socket != null) {
            socket.emit("roomDeleted");
            if (currentEditor.indexOf(socket.id) >= 0)
                currentEditor.splice(currentEditor.indexOf(socket.id), 1);
        }
    });
}

function createARObject(socket, identifier, data, scale, type) {
    let ref = database.ref();
    let temp = 0;

    var typeRef;
    var typeExt;

    switch (type) {
    case ResourceType.IMAGE:
        typeRef = "images";
        typeExt = ".png";
        break;
    case ResourceType.SOUND:
        typeRef = "sounds";
        typeExt = ".mp3";
        break;
    case ResourceType.VIDEO:
        typeRef = "videos";
        typeExt = ".mp4";
        break;
    }

    console.log(currentFree[type]);
    if (currentFree[type].length > 0) {
        temp = currentFree[type].pop();
        console.log(temp);

        const r = ref.child("freed_resource/" + typeRef).orderByChild("value").equalTo(temp);
        const e = r.on('child_added', function(snapshot) {
            r.off('child_added', e);
            snapshot.ref.set(null);
        });
    } else {
        switch (type) {
        case ResourceType.IMAGE:
            temp = imageCount;
            imageCount++;
            break;
        case ResourceType.SOUND:
            temp = soundCount;
            soundCount++;
            break;
        case ResourceType.VIDEO:
            temp = videoCount;
            videoCount++;
            break;
        }
    }

    fs.writeFile(temp + typeExt, data, 'base64', function(err){
        if (err) throw err
        console.log('File saved.')
    })

    let anchor = {
        anchor_identifier: identifier,
        resource_identifier: temp,
        scaling: scale,
        type: type
    }

    ref.child("room_list/" + currentEditor[socket.id] + "/object_list").push(anchor);

    socket.emit("ARObjectCreatedSuccessful", temp, identifier);
}

function removeARObject(socket, identifier, type) {
    let ref = database.ref();

    const r = ref.child("room_list/" + currentEditor[socket.id] + "/object_list").orderByChild("anchor_identifier").equalTo(identifier);
    const e = r.on('child_added', function(snapshot) {
        r.off('child_added', e);

        switch (type) {
        case ResourceType.IMAGE:
            ref.child("freed_resource/images").push({value: snapshot.val().resource_identifier});
            break;
        case ResourceType.SOUND:
            ref.child("freed_resource/sounds").push({value: snapshot.val().resource_identifier});
            break;
        case ResourceType.VIDEO:
            ref.child("freed_resource/videos").push({value: snapshot.val().resource_identifier});
            break;
        }
        currentFree[type].push(snapshot.val().resource_identifier);

        snapshot.ref.set(null);
        socket.emit("ARObjectRemovedSuccessful");
    });
}

function requestARResource(socket, identifier, type) {
    var data;
    console.log(type);
    switch (type) {
    case ResourceType.IMAGE:
        console.log("This happened 1");
        data = fs.readFileSync(identifier + ".png", 'base64');
        break;
    case ResourceType.SOUND:
        console.log("This happened 2");
        data = fs.readFileSync(identifier + ".mp3", 'base64');
        break;
    case ResourceType.VIDEO:
        console.log("This happened 3");
        data = fs.readFileSync(identifier + ".mp4", 'base64');
        break;
    }
    socket.emit("imageDataForARObject", identifier, type, data);
}