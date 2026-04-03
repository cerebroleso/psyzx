using Microsoft.EntityFrameworkCore;
using psyzx.Models;

namespace psyzx.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users { get; set; } = null!;
    public DbSet<Artist> Artists { get; set; } = null!;
    public DbSet<Album> Albums { get; set; } = null!;
    public DbSet<Track> Tracks { get; set; } = null!;
    
    // NUOVE TABELLE
    public DbSet<Playlist> Playlists { get; set; } = null!;
    public DbSet<PlaylistTrack> PlaylistTracks { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>().HasIndex(u => u.Username).IsUnique();

        modelBuilder.Entity<Artist>()
            .HasMany(a => a.Albums)
            .WithOne(al => al.Artist)
            .HasForeignKey(al => al.ArtistId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Album>()
            .HasMany(al => al.Tracks)
            .WithOne(t => t.Album)
            .HasForeignKey(t => t.AlbumId)
            .OnDelete(DeleteBehavior.Cascade);

        // Relazione Utente -> Playlists
        modelBuilder.Entity<User>()
            .HasMany<Playlist>()
            .WithOne(p => p.User)
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Relazione Playlist -> PlaylistTracks
        modelBuilder.Entity<Playlist>()
            .HasMany(p => p.PlaylistTracks)
            .WithOne(pt => pt.Playlist)
            .HasForeignKey(pt => pt.PlaylistId)
            .OnDelete(DeleteBehavior.Cascade);
            
        // Relazione Track -> PlaylistTracks
        modelBuilder.Entity<Track>()
            .HasMany<PlaylistTrack>()
            .WithOne(pt => pt.Track)
            .HasForeignKey(pt => pt.TrackId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}