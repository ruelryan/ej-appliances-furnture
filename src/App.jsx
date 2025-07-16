import React, { useState, useEffect } from 'react';
import {
  AppBar, Toolbar, Typography, Button, Container, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Dialog, DialogActions, DialogContent, DialogTitle, Select, MenuItem, InputLabel, FormControl, Box
} from '@mui/material';

const API_URL = '/.netlify/functions/googleSheet';
const DATABASES = [
  { label: 'Contracts Database', value: 'Contracts Database' },
  { label: 'Payments Database', value: 'Payments Database' },
];
const PASSWORD = 'admin123'; // Change this to your desired password

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [db, setDb] = useState(DATABASES[0].value);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [editIndex, setEditIndex] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);

  // Login logic
  if (!loggedIn) {
    return (
      <Container maxWidth="xs" sx={{ mt: 10 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h5" align="center" gutterBottom>Login</Typography>
          <TextField
            label="Password"
            type="password"
            fullWidth
            value={password}
            onChange={e => setPassword(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Button
            variant="contained"
            color="primary"
            fullWidth
            onClick={() => { if (password === PASSWORD) setLoggedIn(true); }}
          >
            Login
          </Button>
        </Paper>
      </Container>
    );
  }

  // Fetch data
  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}?sheet=${encodeURIComponent(db)}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.length > 0) {
          setHeaders(data[0].map((h, i) => h || `Column ${i+1}`));
          setRows(data.slice(1).filter(row => row.some(cell => cell)));
        } else {
          setHeaders([]);
          setRows([]);
        }
        setLoading(false);
      });
  }, [db]);

  // Open Add/Edit dialog
  const handleOpenDialog = (row = {}, index = null) => {
    setForm(Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])));
    setEditIndex(index);
    setOpenDialog(true);
  };

  // Handle Add/Edit submit
  const handleSubmit = () => {
    const rowArr = headers.map(h => form[h] || '');
    setLoading(true);
    if (editIndex === null) {
      // Add
      fetch(`${API_URL}?sheet=${encodeURIComponent(db)}`, {
        method: 'POST',
        body: JSON.stringify({ row: rowArr }),
      }).then(() => {
        setOpenDialog(false);
        setEditIndex(null);
        setForm({});
        setLoading(false);
        // Refresh
        fetch(`${API_URL}?sheet=${encodeURIComponent(db)}`)
          .then(res => res.json())
          .then(data => {
            setHeaders(data[0].map((h, i) => h || `Column ${i+1}`));
            setRows(data.slice(1).filter(row => row.some(cell => cell)));
          });
      });
    } else {
      // Edit
      fetch(`${API_URL}?sheet=${encodeURIComponent(db)}`, {
        method: 'PUT',
        body: JSON.stringify({ rowIndex: editIndex + 1, row: rowArr }),
      }).then(() => {
        setOpenDialog(false);
        setEditIndex(null);
        setForm({});
        setLoading(false);
        // Refresh
        fetch(`${API_URL}?sheet=${encodeURIComponent(db)}`)
          .then(res => res.json())
          .then(data => {
            setHeaders(data[0].map((h, i) => h || `Column ${i+1}`));
            setRows(data.slice(1).filter(row => row.some(cell => cell)));
          });
      });
    }
  };

  // Handle Delete
  const handleDelete = (index) => {
    setLoading(true);
    fetch(`${API_URL}?sheet=${encodeURIComponent(db)}`, {
      method: 'DELETE',
      body: JSON.stringify({ rowIndex: index + 1 }),
    }).then(() => {
      setLoading(false);
      // Refresh
      fetch(`${API_URL}?sheet=${encodeURIComponent(db)}`)
        .then(res => res.json())
        .then(data => {
          setHeaders(data[0].map((h, i) => h || `Column ${i+1}`));
          setRows(data.slice(1).filter(row => row.some(cell => cell)));
        });
    });
  };

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            E & J Appliances Furniture Database
          </Typography>
          <Button color="inherit" onClick={() => setLoggedIn(false)}>Logout</Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 4 }}>
        <FormControl sx={{ mb: 2, minWidth: 220 }}>
          <InputLabel>Database</InputLabel>
          <Select
            value={db}
            label="Database"
            onChange={e => setDb(e.target.value)}
          >
            {DATABASES.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="contained" sx={{ mb: 2, ml: 2 }} onClick={() => handleOpenDialog()}>Add Row</Button>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                {headers.map((h, i) => <TableCell key={i}>{h}</TableCell>)}
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  {headers.map((h, j) => <TableCell key={j}>{row[j]}</TableCell>)}
                  <TableCell>
                    <Button size="small" onClick={() => handleOpenDialog(row, i)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => handleDelete(i)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Dialog open={openDialog} onClose={() => setOpenDialog(false)}>
          <DialogTitle>{editIndex === null ? 'Add Row' : 'Edit Row'}</DialogTitle>
          <DialogContent>
            {headers.map((h, i) => (
              <TextField
                key={i}
                margin="dense"
                label={h}
                fullWidth
                value={form[h] || ''}
                onChange={e => setForm({ ...form, [h]: e.target.value })}
              />
            ))}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editIndex === null ? 'Add' : 'Save'}</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
}

export default App;
